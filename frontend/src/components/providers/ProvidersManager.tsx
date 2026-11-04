import React, { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { LLMProvider } from "../../types";
import { ProviderChip } from "./ProviderBadges";
import { ProviderCard } from "./ProviderCard";
import { ProviderEditor } from "./ProviderEditor";
import { useProviders } from "./ProvidersContext";

export interface ProvidersManagerProps {
  /**
   * "admin": the Admin area, where system providers are managed.
   * "profile": the user's Profile area. System providers are listed read-only with their last
   * known status (no details, no actions, no connection checks), for admins as well; they manage
   * system providers only in the Admin area.
   */
  variant: "admin" | "profile";
  /** BYOP policy from the server (admin toggle). */
  allowUserProviders: boolean;
}

/** Provider fleet management. */
export const ProvidersManager: React.FC<ProvidersManagerProps> = ({ variant, allowUserProviders }) => {
  const store = useProviders();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const isAdminArea = variant === "admin";
  const system = store.providers.filter((p) => p.scope === "system");
  const personal = store.providers.filter((p) => p.scope === "user");
  const canAddPersonal = !isAdminArea && allowUserProviders;

  const renderCard = (p: LLMProvider, canEdit: boolean) => (
    <ProviderCard
      key={p.id}
      provider={p}
      status={store.status[p.id]}
      expanded={expandedId === p.id}
      canEdit={canEdit}
      onToggle={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
      onProbe={() => void store.probe(p.id, { force: true })}
    />
  );

  return (
    <div className="providers-manager">
      <div className="providers-toolbar">
        <div className="providers-intro">
          {isAdminArea
            ? "A provider is a server that runs models (for now: Ollama). Pick providers for the Actor and Clerk in the Models tab. Provider changes apply immediately."
            : "System providers are managed by the administrator and listed here with their last known status."}
        </div>
        {(isAdminArea || personal.length > 0) && (
          <button type="button" className="btn btn-sm" onClick={() => void store.probeAll({ force: true })}>
            <RefreshCw size={13} /> {isAdminArea ? "Check all" : "Check mine"}
          </button>
        )}
      </div>

      {store.loadError && <div className="auth-alert auth-alert-error">{store.loadError}</div>}
      {store.loading && store.providers.length === 0 && <div className="providers-empty">Loading providers…</div>}

      <section>
        <div className="providers-section-title">
          System providers
          {isAdminArea && (
            <button type="button" className="btn btn-sm" onClick={() => setAdding(true)} disabled={adding}>
              <Plus size={13} /> Add provider
            </button>
          )}
        </div>
        {adding && isAdminArea && (
          <div className="provider-card expanded">
            <ProviderEditor mode="create" scope="system" onDone={() => setAdding(false)} />
          </div>
        )}
        {system.length === 0 && !store.loading && (
          <div className="providers-empty">No system providers are configured yet.</div>
        )}
        {isAdminArea
          ? system.map((p) => renderCard(p, true))
          : system.map((p) => (
              <div key={p.id} className="provider-card provider-card--readonly">
                <div className="provider-card-header">
                  <ProviderChip providerId={p.id} />
                  {!p.is_enabled && <span className="provider-flag">Disabled</span>}
                </div>
              </div>
            ))}
      </section>

      {!isAdminArea && (
        <section>
          <div className="providers-section-title">
            Your personal providers
            {canAddPersonal && (
              <button type="button" className="btn btn-sm" onClick={() => setAdding(true)} disabled={adding}>
                <Plus size={13} /> Add provider
              </button>
            )}
          </div>
          {!allowUserProviders && (
            <div className="provider-note">
              The administrator has not enabled personal providers. You can use the system providers above.
            </div>
          )}
          {adding && canAddPersonal && (
            <div className="provider-card expanded">
              <ProviderEditor mode="create" scope="user" onDone={() => setAdding(false)} />
            </div>
          )}
          {allowUserProviders && personal.length === 0 && !adding && (
            <div className="providers-empty">
              You have no personal providers. Personal providers are private to you and cannot target local or
              private-network addresses.
            </div>
          )}
          {personal.map((p) => renderCard(p, true))}
        </section>
      )}
    </div>
  );
};
