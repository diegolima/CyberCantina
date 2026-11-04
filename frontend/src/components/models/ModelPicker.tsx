import React, { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { LLMProvider } from "../../types";
import { ProviderColorPill, ScopeBadge, StatusDot } from "../providers/ProviderBadges";
import { useProviders } from "../providers/ProvidersContext";
import {
  ModelKind,
  RoleSelection,
  describeIssue,
  filterByKind,
  modelAfterProviderChange,
  modelsForProvider,
  pickerIssues,
  sameModel,
} from "./modelPickerLogic";

export interface ModelPickerProps {
  /** Used for element ids and accessible names. */
  role: string;
  value: RoleSelection;
  onChange: (next: RoleSelection) => void;
  modelKind: ModelKind;
  /** Embedding uses a global, system-scope provider only. */
  systemOnly?: boolean;
  disabled?: boolean;
}

/**
 * Provider -> model cascade. Rules: a selection is NEVER replaced silently (a saved model that is
 * missing stays visible with a warning); changing provider keeps the model only if the new provider
 * has it, otherwise clears it so the form is invalid until the user picks one.
 */
export const ModelPicker: React.FC<ModelPickerProps> = ({
  role,
  value,
  onChange,
  modelKind,
  systemOnly,
  disabled,
}) => {
  const store = useProviders();
  const [showAll, setShowAll] = useState(false);

  const selected = store.byId(value.providerId);
  const live = value.providerId ? store.status[value.providerId]?.result : undefined;
  const { models, source } = useMemo(() => modelsForProvider(selected, live), [selected, live]);
  const visibleModels = filterByKind(models, modelKind, showAll);
  const hidden = models.length - filterByKind(models, modelKind, false).length;
  const unreachable = value.providerId ? store.status[value.providerId]?.state === "unreachable" : false;
  const issues = pickerIssues(value, selected, visibleModels, source, unreachable ? false : undefined);

  const selectable = (p: LLMProvider) =>
    (!systemOnly || p.scope === "system") && ((p.is_enabled && p.usable) || p.id === value.providerId);
  const options = store.providers.filter(selectable);
  const groups: { label: string; items: LLMProvider[] }[] = [
    { label: "System providers", items: options.filter((p) => p.scope === "system") },
    { label: "Personal providers", items: options.filter((p) => p.scope === "user") },
  ];

  const handleProvider = (providerId: string) => {
    const next = store.byId(providerId);
    const nextLive = store.status[providerId]?.result;
    const { models: nextModels } = modelsForProvider(next, nextLive);
    onChange({
      providerId: providerId || null,
      model: modelAfterProviderChange(value.model, filterByKind(nextModels, modelKind, showAll)),
    });
  };

  const modelInList = visibleModels.some((m) => sameModel(m.name, value.model));
  const providerId = `${role}-provider`;
  const modelId = `${role}-model`;

  return (
    <div className="model-picker">
      <div className="grid-2">
        <div className="form-group">
          <label className="form-label" htmlFor={providerId}>
            Provider
          </label>
          <select
            id={providerId}
            className="form-input"
            value={value.providerId ?? ""}
            disabled={disabled}
            onChange={(e) => handleProvider(e.target.value)}
          >
            <option value="">Select a provider…</option>
            {value.providerId && !selected && (
              <option value={value.providerId}>(missing provider)</option>
            )}
            {groups.map(
              (g) =>
                g.items.length > 0 && (
                  <optgroup key={g.label} label={g.label}>
                    {g.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {!p.is_enabled ? " (disabled)" : !p.usable ? " (unavailable)" : ""}
                      </option>
                    ))}
                  </optgroup>
                )
            )}
          </select>
          {selected && (
            <div className="model-picker-provider-line">
              <StatusDot provider={selected} status={store.status[selected.id]} />
              <ProviderColorPill color={selected.color}>{selected.name}</ProviderColorPill>
              <ScopeBadge scope={selected.scope} />
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor={modelId}>
            Model
          </label>
          {models.length > 0 ? (
            <select
              id={modelId}
              className="form-input"
              value={value.model}
              disabled={disabled || !value.providerId}
              onChange={(e) => onChange({ ...value, model: e.target.value })}
            >
              {!value.model && <option value="">Select a model…</option>}
              {value.model && !modelInList && (
                <option value={value.model}>{value.model} (not installed)</option>
              )}
              {visibleModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.parameter_size ? ` (${m.parameter_size}${m.quantization_level ? `, ${m.quantization_level}` : ""})` : ""}
                  {m.size_mb ? ` · ${m.size_mb} MB` : ""}
                  {source === "cached" ? " · cached" : ""}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={modelId}
              className="form-input"
              value={value.model}
              disabled={disabled || !value.providerId}
              placeholder="No model list available. Type a model name"
              onChange={(e) => onChange({ ...value, model: e.target.value })}
            />
          )}
          {hidden > 0 && (
            <label className="provider-inline-check">
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
              Show all {models.length} models (not only {modelKind === "chat" ? "chat" : "embedding"} models)
            </label>
          )}
        </div>
      </div>

      {issues.map((issue, i) => (
        <div key={i} className="provider-warning" role="alert">
          <AlertTriangle size={13} /> {describeIssue(issue)}
        </div>
      ))}
      {!value.providerId && !disabled && store.providers.length > 0 && (
        <div className="provider-warning" role="alert">
          <AlertTriangle size={13} /> Choose a provider to continue.
        </div>
      )}
    </div>
  );
};
