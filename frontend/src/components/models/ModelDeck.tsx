import React, { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useProviders } from "../providers/ProvidersContext";
import { IntegerField } from "./IntegerField";
import { ModelCard } from "./ModelCard";
import {
  DEFAULT_ACTOR_CONTEXT_SIZE,
  DEFAULT_CLERK_CONTEXT_SIZE,
  TEMPERATURE_SPEC,
  contextSizeSpec,
  formatContextTokens,
  maxTokensSpec,
} from "./modelLimits";
import { RoleSelection } from "./modelPickerLogic";
import { NumericSliderField } from "./NumericSliderField";
import { formatValue } from "./sliderMath";

export interface ModelDeckProps {
  scope: "admin" | "user";
  isLocked?: boolean;

  // Actor
  actorSelection: RoleSelection;
  onActorSelection?: (sel: RoleSelection) => void;
  actorTemp: number;
  onActorTemp?: (v: number) => void;
  actorTokens: number;
  onActorTokens?: (v: number) => void;
  actorKeepAlive?: number;
  onActorKeepAlive?: (v: number) => void;
  actorContextSize?: number;
  onActorContextSize?: (v: number) => void;
  actorOverridden?: boolean;
  onResetActor?: () => void;

  // Clerk
  clerkSelection: RoleSelection;
  onClerkSelection?: (sel: RoleSelection) => void;
  clerkTemp: number;
  onClerkTemp?: (v: number) => void;
  clerkTokens: number;
  onClerkTokens?: (v: number) => void;
  clerkKeepAlive?: number;
  onClerkKeepAlive?: (v: number) => void;
  clerkContextSize?: number;
  onClerkContextSize?: (v: number) => void;
  clerkMirrorsActor?: boolean;
  onToggleClerkMirror?: (val: boolean) => void;
  clerkRunOnCpu?: boolean;
  onToggleClerkRunOnCpu?: (val: boolean) => void;
  clerkOverridden?: boolean;
  onResetClerk?: () => void;

  // Vectors
  vectorMode: "local_hash" | "openai_compat" | "fastembed";
  onChangeVectorMode?: (mode: "local_hash" | "openai_compat" | "fastembed") => void;
  vectorSelection?: RoleSelection;
  onVectorSelection?: (sel: RoleSelection) => void;
  workingMemoryTurns: number;
  onWorkingMemoryTurns?: (v: number) => void;
  episodicChunkSize?: number;
  onEpisodicChunkSize?: (v: number) => void;
  maxSceneFlags?: number;
  onMaxSceneFlags?: (v: number) => void;
  ephemeralLifespan?: number;
  onEphemeralLifespan?: (v: number) => void;
  minWorkingMemoryTurns?: number;
  onMinWorkingMemoryTurns?: (v: number) => void;
  lodSummaryChunks?: number;
  onLodSummaryChunks?: (v: number) => void;
  lodImportanceBonus?: number;
  onLodImportanceBonus?: (v: number) => void;
  zone2BudgetSharePct?: number;
  onZone2BudgetSharePct?: (v: number) => void;
  recallBudgetProseTokens?: number;
  onRecallBudgetProseTokens?: (v: number) => void;
  recallBudgetCognitionTokens?: number;
  onRecallBudgetCognitionTokens?: (v: number) => void;
  staleEmbeddingsCount?: number;
  reindexing?: boolean;
  onReindex?: () => void;

  onInvalidChange?: (invalidCount: number) => void;
}

export const ModelDeck: React.FC<ModelDeckProps> = ({
  scope,
  isLocked = false,

  actorSelection,
  onActorSelection,
  actorTemp,
  onActorTemp,
  actorTokens,
  onActorTokens,
  actorKeepAlive = 30,
  onActorKeepAlive,
  actorContextSize = DEFAULT_ACTOR_CONTEXT_SIZE,
  onActorContextSize,
  actorOverridden = false,
  onResetActor,

  clerkSelection,
  onClerkSelection,
  clerkTemp,
  onClerkTemp,
  clerkTokens,
  onClerkTokens,
  clerkKeepAlive = 30,
  onClerkKeepAlive,
  clerkContextSize = DEFAULT_CLERK_CONTEXT_SIZE,
  onClerkContextSize,
  clerkMirrorsActor = false,
  onToggleClerkMirror,
  clerkRunOnCpu = false,
  onToggleClerkRunOnCpu,
  clerkOverridden = false,
  onResetClerk,

  vectorMode,
  onChangeVectorMode,
  vectorSelection = { providerId: null, model: "" },
  onVectorSelection,
  workingMemoryTurns,
  onWorkingMemoryTurns,
  episodicChunkSize = 6,
  onEpisodicChunkSize,
  maxSceneFlags = 10,
  onMaxSceneFlags,
  ephemeralLifespan = 40,
  onEphemeralLifespan,
  minWorkingMemoryTurns = 4,
  onMinWorkingMemoryTurns,
  lodSummaryChunks = 6,
  onLodSummaryChunks,
  lodImportanceBonus = 2,
  onLodImportanceBonus,
  zone2BudgetSharePct = 45,
  onZone2BudgetSharePct,
  recallBudgetProseTokens = 450,
  onRecallBudgetProseTokens,
  recallBudgetCognitionTokens = 220,
  onRecallBudgetCognitionTokens,
  staleEmbeddingsCount = 0,
  reindexing = false,
  onReindex,

  onInvalidChange,
}) => {
  const store = useProviders();

  // Validity tracking for Actor
  const [actorTempValid, setActorTempValid] = useState(true);
  const [actorTokensValid, setActorTokensValid] = useState(true);
  const [actorKeepAliveValid, setActorKeepAliveValid] = useState(true);
  const [actorContextValid, setActorContextValid] = useState(true);

  // Validity tracking for Clerk
  const [clerkTempValid, setClerkTempValid] = useState(true);
  const [clerkTokensValid, setClerkTokensValid] = useState(true);
  const [clerkKeepAliveValid, setClerkKeepAliveValid] = useState(true);
  const [clerkContextValid, setClerkContextValid] = useState(true);

  // Validity tracking for Vectors
  const [memNValid, setMemNValid] = useState(true);
  const [memKValid, setMemKValid] = useState(true);
  const [memFlagsValid, setMemFlagsValid] = useState(true);

  // Provider details
  const actorProvider = store.byId(actorSelection.providerId);
  const isActorOllama = !actorProvider || actorProvider.type === "ollama";
  const actorProbeProtocol = actorSelection.providerId
    ? store.status[actorSelection.providerId]?.result?.protocol
    : undefined;
  const isActorNativeOllama = isActorOllama && actorProbeProtocol !== "openai_compat";

  const clerkProvider = store.byId(clerkSelection.providerId);
  const isClerkOllama = !clerkProvider || clerkProvider.type === "ollama";
  const clerkProbeProtocol = clerkSelection.providerId
    ? store.status[clerkSelection.providerId]?.result?.protocol
    : undefined;
  const isClerkNativeOllama = isClerkOllama && clerkProbeProtocol !== "openai_compat";

  // Check if Clerk uses same model as Actor
  const normTag = (m: string) => {
    const c = (m || "").trim().toLowerCase();
    return c.endsWith(":latest") ? c.slice(0, -":latest".length).trim() : c;
  };
  const isSameModelAsActor =
    normTag(clerkSelection.model) === normTag(actorSelection.model) &&
    (clerkSelection.providerId ?? null) === (actorSelection.providerId ?? null);
  const clerkContextMatchesActor = clerkMirrorsActor || isSameModelAsActor;
  const effectiveClerkContext = clerkContextMatchesActor ? actorContextSize : clerkContextSize;

  useEffect(() => {
    if (!isActorNativeOllama) setActorContextValid(true);
  }, [isActorNativeOllama]);

  useEffect(() => {
    if (!isClerkNativeOllama || clerkContextMatchesActor) setClerkContextValid(true);
  }, [isClerkNativeOllama, clerkContextMatchesActor]);

  const actorInvalid =
    (actorTempValid ? 0 : 1) +
    (actorTokensValid ? 0 : 1) +
    (isActorOllama && onActorKeepAlive && !actorKeepAliveValid ? 1 : 0) +
    (isActorNativeOllama && onActorContextSize && !actorContextValid ? 1 : 0);
  const clerkInvalid =
    (clerkTempValid ? 0 : 1) +
    (clerkTokensValid ? 0 : 1) +
    (isClerkOllama && onClerkKeepAlive && !clerkMirrorsActor && !clerkKeepAliveValid ? 1 : 0) +
    (isClerkNativeOllama && !clerkContextMatchesActor && onClerkContextSize && !clerkContextValid ? 1 : 0);
  const vectorInvalid = (memNValid ? 0 : 1) + (memKValid ? 0 : 1) + (memFlagsValid ? 0 : 1);

  const totalInvalid = actorInvalid + clerkInvalid + vectorInvalid;

  useEffect(() => {
    onInvalidChange?.(totalInvalid);
  }, [totalInvalid, onInvalidChange]);

  // Summaries
  const actorSummary = isActorNativeOllama
    ? `Temp ${formatValue(actorTemp, 2)} · ${actorTokens} max tokens · ${formatContextTokens(actorContextSize)} ctx`
    : `Temp ${formatValue(actorTemp, 2)} · ${actorTokens} max tokens`;
  const clerkSummary = isClerkNativeOllama
    ? `Temp ${formatValue(clerkTemp, 2)} · ${clerkTokens} max tokens · ${formatContextTokens(effectiveClerkContext)} ctx`
    : `Temp ${formatValue(clerkTemp, 2)} · ${clerkTokens} max tokens`;
  const vectorSummary = `Turns N=${workingMemoryTurns} · Chunks K=${episodicChunkSize} · Flags=${maxSceneFlags}`;

  const actorHints: string[] = [];
  if (isActorNativeOllama) {
    if (actorContextSize - actorTokens < 2048) {
      actorHints.push(
        `Leaves under 2,048 tokens for prompt input (${actorTokens} max tokens in ${formatContextTokens(actorContextSize)} ctx); Zone 1–4 context may truncate.`
      );
    }
    if (actorContextSize <= 12288 && workingMemoryTurns > 20) {
      actorHints.push(
        `Working Memory N=${workingMemoryTurns} often exceeds ${formatContextTokens(actorContextSize)} Actor context; consider 16k–32k+.`
      );
    }
  }

  const clerkHints: string[] = [];
  if (isClerkNativeOllama) {
    if (effectiveClerkContext - clerkTokens < 2048) {
      clerkHints.push(
        `Leaves under 2,048 tokens for Clerk prompts (${clerkTokens} max tokens in ${formatContextTokens(effectiveClerkContext)} ctx).`
      );
    }
    if (!clerkContextMatchesActor && effectiveClerkContext <= 8192 && episodicChunkSize > 8) {
      clerkHints.push(
        `Chunk size K=${episodicChunkSize} episodic summaries can exceed an 8k Clerk context; consider 16k+ or K ≤ 8.`
      );
    }
    if (!clerkContextMatchesActor && effectiveClerkContext <= 8192 && actorTokens >= 2048) {
      clerkHints.push(
        `Long Actor outputs (${actorTokens} max tokens) plus Clerk schema retries may crowd an 8k Clerk context.`
      );
    }
  }

  return (
    <div className="model-deck-container">
      <div className="model-deck">
        {/* CARD 1: PRIMARY ACTOR */}
        <ModelCard
          role="actor"
          selection={actorSelection}
          onSelection={onActorSelection}
          modelKind="chat"
          isAdminView={scope === "admin"}
          isLocked={isLocked}
          isOverridden={actorOverridden}
          onResetOverride={onResetActor}
          summary={actorSummary}
          invalidCount={actorInvalid}
          drawerContent={
            <div className="model-card-flyout-stack">
              <NumericSliderField
                label="Temperature"
                value={actorTemp}
                spec={TEMPERATURE_SPEC}
                disabled={isLocked}
                onCommit={onActorTemp || (() => {})}
                onValidityChange={setActorTempValid}
              />
              <NumericSliderField
                label="Max tokens"
                value={actorTokens}
                spec={maxTokensSpec("actor")}
                unit="tokens"
                disabled={isLocked}
                onCommit={onActorTokens || (() => {})}
                onValidityChange={setActorTokensValid}
              />
              {isActorNativeOllama && onActorContextSize && (
                <NumericSliderField
                  label="Context size (num_ctx)"
                  value={actorContextSize}
                  spec={contextSizeSpec("actor")}
                  unit="tokens"
                  disabled={isLocked}
                  onCommit={onActorContextSize}
                  onValidityChange={setActorContextValid}
                />
              )}
              {isActorOllama && onActorKeepAlive && (
                <IntegerField
                  label="Ollama keep-alive"
                  value={actorKeepAlive}
                  min={-1}
                  max={1440}
                  hint="Minutes to keep warm in memory (-1 for indefinite, 0 to unload immediately)."
                  disabled={isLocked}
                  onCommit={onActorKeepAlive}
                  onValidityChange={setActorKeepAliveValid}
                />
              )}
              {actorHints.map((hint, idx) => (
                <div
                  key={idx}
                  className="auth-warning-box"
                  style={{ padding: "6px 8px", fontSize: "0.71rem", display: "flex", alignItems: "flex-start", gap: 6 }}
                >
                  <AlertTriangle size={13} style={{ color: "var(--accent-amber)", flexShrink: 0, marginTop: 1 }} />
                  <span>{hint}</span>
                </div>
              ))}
            </div>
          }
        />

        {/* CARD 2: AUXILIARY CLERK */}
        <ModelCard
          role="clerk"
          selection={clerkSelection}
          onSelection={onClerkSelection}
          modelKind="chat"
          isAdminView={scope === "admin"}
          isLocked={isLocked}
          isOverridden={clerkOverridden}
          onResetOverride={onResetClerk}
          mirrorsActor={clerkMirrorsActor}
          onToggleMirror={onToggleClerkMirror}
          runOnCpu={clerkRunOnCpu}
          onToggleRunOnCpu={onToggleClerkRunOnCpu}
          isSameModelAsActor={isSameModelAsActor}
          summary={clerkSummary}
          invalidCount={clerkInvalid}
          drawerContent={
            <div className="model-card-flyout-stack">
              <NumericSliderField
                label="Temperature"
                value={clerkTemp}
                spec={TEMPERATURE_SPEC}
                disabled={isLocked}
                onCommit={onClerkTemp || (() => {})}
                onValidityChange={setClerkTempValid}
              />
              <NumericSliderField
                label="Max tokens"
                value={clerkTokens}
                spec={maxTokensSpec("clerk")}
                unit="tokens"
                disabled={isLocked}
                onCommit={onClerkTokens || (() => {})}
                onValidityChange={setClerkTokensValid}
              />
              {isClerkNativeOllama && onClerkContextSize && (
                clerkContextMatchesActor ? (
                  <div className="provider-note" style={{ fontSize: "0.72rem", padding: "6px 8px" }}>
                    Context size matches Primary Actor ({formatContextTokens(actorContextSize)} / {actorContextSize} tokens) to prevent Ollama model reloads.
                  </div>
                ) : (
                  <NumericSliderField
                    label="Context size (num_ctx)"
                    value={clerkContextSize}
                    spec={contextSizeSpec("clerk")}
                    unit="tokens"
                    disabled={isLocked}
                    onCommit={onClerkContextSize}
                    onValidityChange={setClerkContextValid}
                  />
                )
              )}
              {isClerkOllama && onClerkKeepAlive && !clerkMirrorsActor && (
                <IntegerField
                  label="Ollama keep-alive"
                  value={clerkKeepAlive}
                  min={-1}
                  max={1440}
                  hint="Minutes to keep warm in memory (-1 for indefinite, 0 to unload immediately)."
                  disabled={isLocked}
                  onCommit={onClerkKeepAlive}
                  onValidityChange={setClerkKeepAliveValid}
                />
              )}
              {clerkHints.map((hint, idx) => (
                <div
                  key={idx}
                  className="auth-warning-box"
                  style={{ padding: "6px 8px", fontSize: "0.71rem", display: "flex", alignItems: "flex-start", gap: 6 }}
                >
                  <AlertTriangle size={13} style={{ color: "var(--accent-amber)", flexShrink: 0, marginTop: 1 }} />
                  <span>{hint}</span>
                </div>
              ))}
            </div>
          }
        />

        {/* CARD 3: SEMANTIC VECTORS (Read-only on User Profile, Editable on Admin) */}
        <ModelCard
          role="vectors"
          selection={vectorSelection}
          onSelection={onVectorSelection}
          modelKind="embedding"
          systemOnly
          isAdminView={scope === "admin"}
          isLocked={isLocked || scope === "user"}
          vectorMode={vectorMode}
          onChangeVectorMode={scope === "admin" ? onChangeVectorMode : undefined}
          staleEmbeddingsCount={staleEmbeddingsCount}
          reindexing={reindexing}
          onReindex={onReindex}
          summary={vectorSummary}
          invalidCount={vectorInvalid}
          drawerContent={
            <div className="model-card-flyout-stack">
              <IntegerField
                label="Zone 3 Working Turns (N)"
                min={4}
                max={64}
                value={workingMemoryTurns}
                disabled={isLocked || scope === "user"}
                onCommit={onWorkingMemoryTurns || (() => {})}
                onValidityChange={setMemNValid}
              />
              {onEpisodicChunkSize && (
                <IntegerField
                  label="Zone 2 Chunk Size (K)"
                  min={2}
                  max={16}
                  value={episodicChunkSize}
                  disabled={isLocked || scope === "user"}
                  onCommit={onEpisodicChunkSize}
                  onValidityChange={setMemKValid}
                />
              )}
              {onMaxSceneFlags && (
                <IntegerField
                  label="Max Scene Flags"
                  min={1}
                  max={50}
                  value={maxSceneFlags}
                  disabled={isLocked || scope === "user"}
                  onCommit={onMaxSceneFlags}
                  onValidityChange={setMemFlagsValid}
                />
              )}
              {onEphemeralLifespan && (
                <IntegerField
                  label="Ephemeral Memory Lifespan (turns)"
                  min={4}
                  max={200}
                  value={ephemeralLifespan}
                  disabled={isLocked || scope === "user"}
                  onCommit={onEphemeralLifespan}
                />
              )}
              {onMinWorkingMemoryTurns && (
                <IntegerField
                  label="Zone 3 Min Protected Turns"
                  min={1}
                  max={32}
                  value={minWorkingMemoryTurns}
                  disabled={isLocked || scope === "user"}
                  onCommit={onMinWorkingMemoryTurns}
                />
              )}
              {onLodSummaryChunks && (
                <IntegerField
                  label="Zone 2 LOD Summary Chunks"
                  min={1}
                  max={32}
                  value={lodSummaryChunks}
                  disabled={isLocked || scope === "user"}
                  onCommit={onLodSummaryChunks}
                />
              )}
              {onLodImportanceBonus && (
                <IntegerField
                  label="Zone 2 Salience Bonus"
                  min={0}
                  max={10}
                  value={lodImportanceBonus}
                  disabled={isLocked || scope === "user"}
                  onCommit={onLodImportanceBonus}
                />
              )}
              {onZone2BudgetSharePct && (
                <IntegerField
                  label="Zone 2 History Budget Share (%)"
                  min={10}
                  max={80}
                  value={zone2BudgetSharePct}
                  disabled={isLocked || scope === "user"}
                  onCommit={onZone2BudgetSharePct}
                />
              )}
              {onRecallBudgetProseTokens && (
                <IntegerField
                  label="Zone 4 Prose Recall Budget (tok)"
                  min={100}
                  max={2000}
                  value={recallBudgetProseTokens}
                  disabled={isLocked || scope === "user"}
                  onCommit={onRecallBudgetProseTokens}
                />
              )}
              {onRecallBudgetCognitionTokens && (
                <IntegerField
                  label="Phase 3 Cognition Recall Budget (tok)"
                  min={60}
                  max={1000}
                  value={recallBudgetCognitionTokens}
                  disabled={isLocked || scope === "user"}
                  onCommit={onRecallBudgetCognitionTokens}
                />
              )}
            </div>
          }
        />
      </div>
    </div>
  );
};
