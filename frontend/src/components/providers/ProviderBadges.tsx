import React from "react";
import { Server, User } from "lucide-react";
import { LLMProvider, ProbeErrorCode, ProviderColor, ProviderScope } from "../../types";
import { ProviderStatus, useProviders } from "./ProvidersContext";

export const PROVIDER_COLORS: { value: ProviderColor; label: string }[] = [
  { value: "neutral", label: "None" },
  { value: "cyan", label: "Cyan" },
  { value: "purple", label: "Purple" },
  { value: "indigo", label: "Indigo" },
  { value: "bronze", label: "Bronze" },
];

export function describeProbeError(code: ProbeErrorCode | null | undefined): string {
  switch (code) {
    case "dns_failure":
      return "The server name could not be resolved.";
    case "connect_refused":
      return "Connection refused: is the server running?";
    case "timeout":
      return "The server did not answer in time.";
    case "tls_error":
      return "TLS/certificate error.";
    case "unauthorized":
      return "The server rejected the credentials (401).";
    case "forbidden":
      return "Access denied by the server (403).";
    case "not_found":
      return "No Ollama or OpenAI-compatible API was found at this URL.";
    case "bad_payload":
      return "The server returned an unexpected response.";
    case "blocked_by_policy":
      return "This address is not allowed for personal providers.";
    case "invalid_url":
      return "The server URL is invalid.";
    case "rate_limited":
      return "Too many checks; try again in a minute.";
    case "relay_offline":
      return "Browser inference relay is offline. Keep this tab open and connected.";
    case "webgpu_unsupported":
      return "WebGPU is not available in this browser.";
    default:
      return "The server could not be reached.";
  }
}

/** Connection indicator: shape AND label (never colour alone) so it works for colour-blind users. */
export const StatusDot: React.FC<{ provider: LLMProvider; status?: ProviderStatus }> = ({
  provider,
  status,
}) => {
  let kind: "connected" | "unreachable" | "probing" | "unknown" | "disabled" = "unknown";
  if (!provider.is_enabled) kind = "disabled";
  else if (status?.state === "connected") kind = "connected";
  else if (status?.state === "unreachable") kind = "unreachable";
  else if (status?.state === "probing") kind = "probing";
  else if (provider.last_probed_at) {
    // No live status in this view (e.g. the profile area): show the last server-side probe result.
    kind = provider.last_error_code ? "unreachable" : "connected";
  }
  const lastCheck = !status?.result && !!provider.last_probed_at;

  const text: Record<typeof kind, string> = {
    connected: lastCheck ? "Last check: connected" : "Connected",
    unreachable: status?.result?.error_code
      ? `Unreachable: ${describeProbeError(status.result.error_code)}`
      : lastCheck
        ? "Last check: unreachable"
        : "Unreachable",
    probing: "Checking connection",
    unknown: "Not checked yet",
    disabled: "Disabled",
  };
  return (
    <span
      className={`provider-dot provider-dot--${kind}`}
      role="img"
      aria-label={text[kind]}
      title={text[kind]}
    />
  );
};

export const ProviderColorPill: React.FC<{ color: ProviderColor; children: React.ReactNode }> = ({
  color,
  children,
}) => <span className={`provider-pill provider-pill--${color}`}>{children}</span>;

export const ScopeBadge: React.FC<{ scope: ProviderScope }> = ({ scope }) =>
  scope === "system" ? (
    <span className="scope-badge scope-badge--system" title="Managed by the administrator, shared with everyone">
      <Server size={11} /> System
    </span>
  ) : (
    <span className="scope-badge scope-badge--user" title="Private to your account">
      <User size={11} /> Personal
    </span>
  );

/** Compact "provider + status" chip for a provider id (name pill, scope badge, last/live status). */
export const ProviderChip: React.FC<{ providerId?: string | null }> = ({ providerId }) => {
  const store = useProviders();
  const provider = store.byId(providerId);
  if (!provider) {
    return <span className="provider-flag">Provider unavailable</span>;
  }
  return (
    <span className="provider-chip">
      <StatusDot provider={provider} status={store.status[provider.id]} />
      <ProviderColorPill color={provider.color}>{provider.name}</ProviderColorPill>
      <ScopeBadge scope={provider.scope} />
    </span>
  );
};
