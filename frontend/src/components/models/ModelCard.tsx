import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Brain,
  Cpu,
  Database,
  Link,
  Lock,
  Monitor,
  RefreshCw,
  RotateCcw,
  Sliders,
  User,
  ChevronUp,
} from "lucide-react";
import { LLMProvider } from "../../types";
import { ProviderColorPill, StatusDot } from "../providers/ProviderBadges";
import { useProviders } from "../providers/ProvidersContext";
import { parseModelName, roleDisplayMeta } from "./modelFormatting";
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
import { ThemedPickerDropdown, ThemedPickerOption } from "./ThemedPickerDropdown";

export interface ModelCardProps {
  role: "actor" | "clerk" | "vectors";
  /** Provider and model selection */
  selection?: RoleSelection;
  onSelection?: (next: RoleSelection) => void;
  modelKind?: ModelKind;
  /** System-only provider restriction (e.g. for embeddings) */
  systemOnly?: boolean;
  /** Advanced configuration drawer contents (sliders, number fields) */
  drawerContent?: React.ReactNode;
  /** Summary shown on the bottom shelf (e.g. "Temp 0.70 · 4096 tokens") */
  summary?: string;
  /** Whether the card is locked (e.g. user profile when admin disabled overrides) */
  isLocked?: boolean;
  /** Scope in user profile: true if user override is active */
  isOverridden?: boolean;
  /** Scope in admin modal: true if this is system default */
  isAdminView?: boolean;
  /** Callback to reset override back to system default */
  onResetOverride?: () => void;
  /** Clerk-specific: whether Clerk mirrors Actor */
  mirrorsActor?: boolean;
  onToggleMirror?: (val: boolean) => void;
  /** Clerk-specific: whether Clerk runs on CPU */
  runOnCpu?: boolean;
  onToggleRunOnCpu?: (val: boolean) => void;
  isSameModelAsActor?: boolean;
  /** Vectors-specific: embedding mode */
  vectorMode?: "local_hash" | "openai_compat" | "fastembed";
  onChangeVectorMode?: (mode: "local_hash" | "openai_compat" | "fastembed") => void;
  staleEmbeddingsCount?: number;
  reindexing?: boolean;
  onReindex?: () => void;
  /** Invalid count indicator */
  invalidCount?: number;
}

export const ModelCard: React.FC<ModelCardProps> = ({
  role,
  selection = { providerId: null, model: "" },
  onSelection,
  modelKind = "chat",
  systemOnly = false,
  drawerContent,
  summary,
  isLocked = false,
  isOverridden = false,
  isAdminView = false,
  onResetOverride,
  mirrorsActor = false,
  onToggleMirror,
  runOnCpu = false,
  onToggleRunOnCpu,
  isSameModelAsActor = false,
  vectorMode = "local_hash",
  onChangeVectorMode,
  staleEmbeddingsCount = 0,
  reindexing = false,
  onReindex,
  invalidCount = 0,
}) => {
  const store = useProviders();
  const [isExpanded, setIsExpanded] = useState(false);
  const [openDropdowns, setOpenDropdowns] = useState(0);
  const showAllModels = false;
  const flyoutRef = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);

  const { title, subtitle, accent } = roleDisplayMeta(role);
  const selectedProvider = store.byId(selection.providerId);
  const live = selection.providerId ? store.status[selection.providerId]?.result : undefined;
  const { models, source } = useMemo(() => modelsForProvider(selectedProvider, live), [selectedProvider, live]);
  const visibleModels = filterByKind(models, modelKind, showAllModels);
  const unreachable = selection.providerId ? store.status[selection.providerId]?.state === "unreachable" : false;
  const issues = pickerIssues(selection, selectedProvider, visibleModels, source, unreachable ? false : undefined);

  // Clean model name
  const parsedModel = parseModelName(selection.model);

  // Track popover open state so parent card gets elevated z-index
  const handleDropdownOpenChange = (open: boolean) => {
    setOpenDropdowns((prev) => Math.max(0, prev + (open ? 1 : -1)));
  };

  // Close flyout on outside click
  useEffect(() => {
    if (!isExpanded) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        flyoutRef.current &&
        !flyoutRef.current.contains(target) &&
        shelfRef.current &&
        !shelfRef.current.contains(target)
      ) {
        setIsExpanded(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isExpanded]);

  const formatProviderBadge = (ptype: LLMProvider["type"]) => {
    if (ptype === "browser_ollama") return "LOCAL OLLAMA";
    if (ptype === "webgpu") return "WEBGPU";
    return ptype.toUpperCase();
  };

  // Provider selectable options
  const selectable = (p: LLMProvider) =>
    (!systemOnly || p.scope === "system") && ((p.is_enabled && p.usable) || p.id === selection.providerId);
  const providerOptions = store.providers.filter(selectable);
  const providerGroups = [
    {
      groupLabel: "System Providers",
      items: providerOptions
        .filter((p) => p.scope === "system")
        .map((p) => ({
          id: p.id,
          label: p.name,
          secondaryLabel: formatProviderBadge(p.type),
          badge: <ProviderColorPill color={p.color}>{p.name}</ProviderColorPill>,
          icon: <StatusDot provider={p} status={store.status[p.id]} />,
          isCurrent: p.id === selection.providerId,
        })),
    },
    {
      groupLabel: "Personal Providers",
      items: providerOptions
        .filter((p) => p.scope === "user")
        .map((p) => ({
          id: p.id,
          label: p.name,
          secondaryLabel: formatProviderBadge(p.type),
          badge: <ProviderColorPill color={p.color}>{p.name}</ProviderColorPill>,
          icon: <StatusDot provider={p} status={store.status[p.id]} />,
          isCurrent: p.id === selection.providerId,
        })),
    },
  ].filter((g) => g.items.length > 0);

  // Model selectable options
  const modelOptions: ThemedPickerOption[] = visibleModels.map((m) => {
    const parsed = parseModelName(m.name);
    return {
      id: m.name,
      label: parsed.displayName,
      secondaryLabel: parsed.vendor,
      badge: parsed.tag ? <span className="model-tag-pill">{parsed.tag}</span> : undefined,
      isCurrent: sameModel(m.name, selection.model),
    };
  });

  // Vector Engine options
  const vectorEngineOptions: ThemedPickerOption[] = [
    {
      id: "local_hash",
      label: "Feature Hash (Zero VRAM)",
      secondaryLabel: "Deterministic hashing · Sub-millisecond recall",
      badge: <span className="model-tag-pill">0 VRAM</span>,
      isCurrent: vectorMode === "local_hash",
    },
    {
      id: "openai_compat",
      label: "Provider Embeddings",
      secondaryLabel: "Ollama /api/embed or OpenAI-compatible endpoint",
      badge: <span className="model-tag-pill">Ollama / API</span>,
      isCurrent: vectorMode === "openai_compat",
    },
    {
      id: "fastembed",
      label: "Local ONNX FastEmbed",
      secondaryLabel: "In-process ONNX neural embeddings",
      badge: <span className="model-tag-pill">Neural ONNX</span>,
      isCurrent: vectorMode === "fastembed",
    },
  ];

  const handleProviderSelect = (newProviderId: string) => {
    if (!onSelection) return;
    const nextProv = store.byId(newProviderId);
    const nextLive = store.status[newProviderId]?.result;
    const { models: nextModels } = modelsForProvider(nextProv, nextLive);
    onSelection({
      providerId: newProviderId || null,
      model: modelAfterProviderChange(selection.model, filterByKind(nextModels, modelKind, showAllModels)),
    });
  };

  const handleModelSelect = (newModel: string) => {
    if (!onSelection) return;
    onSelection({
      ...selection,
      model: newModel,
    });
  };

  // Watermark icon
  const watermarkIcon =
    role === "actor" ? (
      <Brain size={110} />
    ) : role === "clerk" ? (
      <Cpu size={110} />
    ) : (
      <Database size={110} />
    );

  // Vector mode representation flags
  const isVectorLocalHash = role === "vectors" && vectorMode === "local_hash";
  const isVectorFastEmbed = role === "vectors" && vectorMode === "fastembed";

  const hasActivePopover = openDropdowns > 0 || isExpanded;

  return (
    <div
      className={`model-deck-card role-${role} ${isLocked ? "locked" : ""} ${
        hasActivePopover ? "has-active-popover" : ""
      } ${isExpanded ? "expanded" : ""}`}
      style={{ "--card-accent-color": accent } as React.CSSProperties}
    >
      {/* Visual background scrim & watermark */}
      <div className="model-deck-card-scrim-container">
        <div className="model-deck-card-scrim" />
        <div className="model-deck-card-watermark">{watermarkIcon}</div>
      </div>

      {/* Card Header */}
      <div className="model-card-header">
        <div className="model-card-title-group">
          <div className="model-card-role-title" style={{ color: accent }}>
            {title}
          </div>
          <div className="model-card-role-sub">{subtitle}</div>
        </div>

        <div className="model-card-badges">
          {isAdminView ? (
            <span
              className="model-scope-icon-badge system"
              title="System Default: configured by administrator"
              aria-label="System Default"
            >
              <Monitor size={13} />
            </span>
          ) : isLocked ? (
            <span
              className="model-scope-icon-badge locked"
              title="Locked: model overrides are disabled by administrator"
              aria-label="Locked by Administrator"
            >
              <Lock size={13} />
            </span>
          ) : isOverridden ? (
            <>
              <span
                className="model-scope-icon-badge override"
                title="User Override: customized for your profile"
                aria-label="User Override"
              >
                <User size={13} />
              </span>
              {onResetOverride && (
                <button
                  type="button"
                  className="model-reset-btn"
                  onClick={onResetOverride}
                  title="Reset to System Default"
                  aria-label="Reset to System Default"
                >
                  <RotateCcw size={12} />
                </button>
              )}
            </>
          ) : (
            <span
              className="model-scope-icon-badge system"
              title="System Default: using global administrator setting"
              aria-label="System Default"
            >
              <Monitor size={13} />
            </span>
          )}
        </div>
      </div>

      {/* Card Body */}
      <div className="model-card-body">
        {/* Vectors Mode Selector using ThemedPickerDropdown */}
        {role === "vectors" && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: 4 }}>
              Embedding Engine
            </div>
            {onChangeVectorMode && !isLocked ? (
              <ThemedPickerDropdown
                label="Select Embedding Engine"
                currentLabel={
                  vectorMode === "local_hash"
                    ? "Feature Hash"
                    : vectorMode === "openai_compat"
                    ? "Provider Embeddings"
                    : "Local ONNX FastEmbed"
                }
                currentTag={
                  vectorMode === "local_hash"
                    ? "0 VRAM"
                    : vectorMode === "openai_compat"
                    ? "Ollama"
                    : "ONNX"
                }
                options={vectorEngineOptions}
                onSelect={(id) => onChangeVectorMode(id as "local_hash" | "openai_compat" | "fastembed")}
                onOpenChange={handleDropdownOpenChange}
                disabled={isLocked}
                buttonVariant="subtle"
                align="right"
              />
            ) : (
              <div style={{ fontSize: "0.8rem", color: "var(--text-primary)", fontWeight: 600, padding: "2px 0" }}>
                {vectorMode === "local_hash"
                  ? "Feature Hash (Zero VRAM)"
                  : vectorMode === "openai_compat"
                  ? "Provider Embeddings"
                  : "Local ONNX FastEmbed"}
              </div>
            )}
          </div>
        )}

        {/* Vectors Stale Memories Warning */}
        {role === "vectors" && staleEmbeddingsCount > 0 && (
          <div
            className="auth-warning-box"
            style={{ padding: "6px 8px", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 6 }}
          >
            <AlertTriangle size={13} style={{ color: "var(--accent-amber)", flexShrink: 0 }} />
            <span style={{ flex: 1, color: "var(--accent-amber)" }}>
              {staleEmbeddingsCount} memories need reindexing.
            </span>
            {onReindex && (
              <button
                type="button"
                className="btn btn-sm"
                style={{ fontSize: "0.68rem", padding: "2px 6px" }}
                onClick={onReindex}
                disabled={reindexing}
              >
                <RefreshCw size={11} className={reindexing ? "spin" : undefined} />
                {reindexing ? "..." : "Reindex"}
              </button>
            )}
          </div>
        )}

        {/* Center Hero Block */}
        <div className="model-card-hero-block">
          {isVectorLocalHash ? (
            <div style={{ padding: "8px 0" }}>
              <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text-primary)" }}>
                Deterministic Hash
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
                Zero GPU VRAM · Sub-millisecond vector indexing
              </div>
            </div>
          ) : isVectorFastEmbed ? (
            <div style={{ padding: "8px 0" }}>
              <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text-primary)" }}>
                Local ONNX Embed
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 2 }}>
                In-process ONNX neural embeddings
              </div>
            </div>
          ) : mirrorsActor ? (
            <div
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                background: "rgba(6, 182, 212, 0.08)",
                border: "1px dashed rgba(6, 182, 212, 0.35)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                width: "100%",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--accent-cyan)", fontWeight: 600, fontSize: "0.84rem" }}>
                <Link size={13} /> Mirrors Primary Model
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                Using Primary Actor provider &amp; model
              </div>
            </div>
          ) : (
            <ThemedPickerDropdown
              label={`Select ${title} Model`}
              currentLabel={parsedModel.displayName}
              currentTag={parsedModel.tag}
              options={modelOptions}
              onSelect={handleModelSelect}
              onOpenChange={handleDropdownOpenChange}
              searchable
              searchPlaceholder="Filter models..."
              disabled={isLocked}
              buttonVariant="hero"
              emptyMessage={unreachable ? "Provider unreachable" : "No models found"}
              align={role === "vectors" ? "right" : "left"}
              warningNote={
                issues.length > 0 ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <AlertTriangle size={12} />
                    <span>{describeIssue(issues[0])}</span>
                  </div>
                ) : undefined
              }
            />
          )}

          {/* Clerk Modifiers (Mirror Actor & CPU mode) placed directly under the model hero selector */}
          {role === "clerk" && (
            <div className="model-card-aux-row" style={{ marginTop: 6, justifyContent: "center" }}>
              {onToggleMirror && !isLocked && (
                <label className="provider-inline-check" style={{ margin: 0, fontSize: "0.72rem" }}>
                  <input
                    type="checkbox"
                    checked={mirrorsActor}
                    onChange={(e) => onToggleMirror(e.target.checked)}
                  />
                  Mirror Primary Actor
                </label>
              )}

              {onToggleRunOnCpu && !mirrorsActor && !isLocked && (
                <label
                  className="provider-inline-check"
                  style={{
                    margin: 0,
                    fontSize: "0.72rem",
                    opacity: !isSameModelAsActor ? 1 : 0.6,
                  }}
                  title={
                    !isSameModelAsActor
                      ? "Offload layers to system RAM (num_gpu: 0)"
                      : "Only active when using a separate model from the Actor"
                  }
                >
                  <input
                    type="checkbox"
                    checked={runOnCpu}
                    disabled={isSameModelAsActor}
                    onChange={(e) => onToggleRunOnCpu(e.target.checked)}
                  />
                  Run on CPU (<code>0 VRAM</code>)
                </label>
              )}

              {/* Read-only indicators on locked user profile */}
              {isLocked && mirrorsActor && (
                <span className="model-tag-pill" style={{ color: "var(--accent-cyan)" }}>
                  Mirrors Actor
                </span>
              )}
              {isLocked && runOnCpu && (
                <span className="model-tag-pill" style={{ color: "var(--accent-cyan)" }}>
                  CPU Mode (0 VRAM)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Provider Row (Pinned to bottom of body across all cards) */}
        {!isVectorLocalHash && !isVectorFastEmbed && !mirrorsActor ? (
          <div className="model-card-provider-row">
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Provider:</span>
            <div style={{ flex: 1, maxWidth: 170 }}>
              <ThemedPickerDropdown
                currentLabel={selectedProvider?.name || "None selected"}
                currentIcon={
                  selectedProvider ? (
                    <StatusDot provider={selectedProvider} status={store.status[selectedProvider.id]} />
                  ) : undefined
                }
                groups={providerGroups}
                onSelect={handleProviderSelect}
                onOpenChange={handleDropdownOpenChange}
                disabled={isLocked}
                buttonVariant="subtle"
                emptyMessage="No providers enabled"
                align="right"
              />
            </div>
          </div>
        ) : mirrorsActor ? (
          <div className="model-card-provider-row" style={{ opacity: 0.75 }}>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Provider:</span>
            <span style={{ fontSize: "0.74rem", color: "var(--text-secondary)" }}>
              Inherited from Primary
            </span>
          </div>
        ) : isVectorLocalHash ? (
          <div className="model-card-provider-row" style={{ opacity: 0.75 }}>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Provider:</span>
            <span style={{ fontSize: "0.74rem", color: "var(--text-secondary)" }}>
              Built-in Hash Engine
            </span>
          </div>
        ) : isVectorFastEmbed ? (
          <div className="model-card-provider-row" style={{ opacity: 0.75 }}>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Provider:</span>
            <span style={{ fontSize: "0.74rem", color: "var(--text-secondary)" }}>
              Local ONNX Runtime
            </span>
          </div>
        ) : null}
      </div>

      {/* Bottom Shelf (Accordion / Flyout Toggle) */}
      {drawerContent && (
        <>
          <div
            ref={shelfRef}
            className={`model-card-shelf ${isExpanded ? "expanded" : ""}`}
            onClick={() => setIsExpanded((prev) => !prev)}
            title="Click to toggle parameter tuning"
          >
            <div className="model-card-shelf-left">
              <Sliders size={13} />
              <span>{summary || "Advanced Parameters"}</span>
            </div>
            {invalidCount > 0 ? (
              <span className="disclosure-invalid">{invalidCount} error</span>
            ) : (
              <span style={{ fontSize: "0.68rem", opacity: 0.7 }}>
                {isExpanded ? "Hide ▲" : "Tuning ▼"}
              </span>
            )}
          </div>

          {/* Floating Configuration Flyout Overlay */}
          {isExpanded && (
            <div
              className="model-card-flyout"
              ref={flyoutRef}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="model-card-flyout-header"
                onClick={() => setIsExpanded(false)}
                title="Click to retract parameter tuning"
              >
                <div className="model-card-flyout-title" style={{ color: accent }}>
                  <Sliders size={13} />
                  <span>{title} Parameters</span>
                </div>
                <button
                  type="button"
                  className="model-card-flyout-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsExpanded(false);
                  }}
                  title="Retract parameters"
                  aria-label="Retract parameters"
                >
                  <ChevronUp size={15} />
                </button>
              </div>
              <div className="model-card-flyout-body">{drawerContent}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
