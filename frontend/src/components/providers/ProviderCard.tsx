import React from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { hasProviderCredential } from "../../local/credentialVault";
import { useOptionalLocalRelay } from "../../providers/LocalRelayContext";
import { LLMProvider, ProviderCredentialStoreMode } from "../../types";
import { ProviderColorPill, ScopeBadge, StatusDot } from "./ProviderBadges";
import { ProviderEditor } from "./ProviderEditor";
import { ProviderStatus } from "./ProvidersContext";

export interface ProviderCardProps {
  provider: LLMProvider;
  status?: ProviderStatus;
  expanded: boolean;
  /** True when the viewer may edit/delete this provider. */
  canEdit: boolean;
  credentialStoreMode?: ProviderCredentialStoreMode;
  onToggle: () => void;
  onProbe: () => void;
}

/** Collapsible row: compact summary header, full editor underneath when expanded. */
export const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  status,
  expanded,
  canEdit,
  credentialStoreMode = "prefer_server",
  onToggle,
  onProbe,
}) => {
  const relay = useOptionalLocalRelay();
  const models = status?.result?.models ?? provider.cached_models;
  const chat = models.filter((m) => !m.is_embedding).length;
  const embed = models.length - chat;
  const probing = status?.state === "probing";
  const unusable = !provider.usable;
  const isBrowserCred =
    provider.scope === "user" &&
    provider.credential_storage === "browser" &&
    provider.type !== "browser_ollama" &&
    provider.type !== "webgpu";
  const hasLocalCred = isBrowserCred
    ? hasProviderCredential(relay?.currentUserId, provider.id)
    : false;
  const requiresKey =
    provider.type === "openrouter" ||
    provider.type === "aihorde" ||
    provider.type === "nanogpt";

  return (
    <div className={`provider-card ${expanded ? "expanded" : ""} ${unusable ? "unusable" : ""}`}>
      <div className="provider-card-header">
        <StatusDot provider={provider} status={status} />
        <ProviderColorPill color={provider.color}>{provider.name}</ProviderColorPill>
        <ScopeBadge scope={provider.scope} />
        {!provider.is_enabled && <span className="provider-flag">Disabled</span>}
        {provider.unusable_reason === "byop_disabled" && (
          <span className="provider-flag" title="Personal providers are disabled by the administrator">
            Unavailable
          </span>
        )}
        {provider.unusable_reason === "browser_storage_disabled" && (
          <span
            className="provider-flag"
            title="Browser-stored credentials are currently disabled by the administrator"
          >
            Browser Storage Disabled
          </span>
        )}
        {isBrowserCred && provider.unusable_reason !== "browser_storage_disabled" && (
          hasLocalCred ? (
            <span
              className="scope-badge scope-badge--user"
              title="API key or token is stored only in this browser"
            >
              Stored in this browser
            </span>
          ) : requiresKey ? (
            <span
              className="provider-flag"
              title="No credential is saved in this browser. Expand and enter your API key to use on this device."
            >
              Key missing in this browser
            </span>
          ) : (
            <span
              className="scope-badge scope-badge--user"
              title="Executes directly from this browser"
            >
              Browser execution
            </span>
          )
        )}
        <span className="provider-subtitle">
          {provider.base_url ?? "Managed by the administrator"}
          {models.length > 0 && ` · ${chat} chat, ${embed} embed`}
        </span>
        <span className="provider-card-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={onProbe}
            disabled={probing || unusable}
            aria-label={`Check connection of ${provider.name}`}
            title="Check connection"
          >
            <RefreshCw size={13} className={probing ? "spin" : undefined} />
          </button>
          {(canEdit || unusable) && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Edit"} ${provider.name}`}
            >
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          )}
        </span>
      </div>
      {expanded && canEdit && (
        <ProviderEditor
          key={provider.version}
          mode="edit"
          provider={provider}
          credentialStoreMode={credentialStoreMode}
          deleteOnly={provider.scope === "user" && provider.unusable_reason === "byop_disabled"}
          onDone={onToggle}
        />
      )}
    </div>
  );
};
