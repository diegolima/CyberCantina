import React, { useEffect, useState } from "react";
import { useProviders } from "../providers/ProvidersContext";
import { IntegerField } from "./IntegerField";
import { ModelCard } from "./ModelCard";
import { TEMPERATURE_SPEC, maxTokensSpec } from "./modelLimits";
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

  // Validity tracking for Clerk
  const [clerkTempValid, setClerkTempValid] = useState(true);
  const [clerkTokensValid, setClerkTokensValid] = useState(true);
  const [clerkKeepAliveValid, setClerkKeepAliveValid] = useState(true);

  // Validity tracking for Vectors
  const [memNValid, setMemNValid] = useState(true);
  const [memKValid, setMemKValid] = useState(true);
  const [memFlagsValid, setMemFlagsValid] = useState(true);

  const actorInvalid = (actorTempValid ? 0 : 1) + (actorTokensValid ? 0 : 1) + (actorKeepAliveValid ? 0 : 1);
  const clerkInvalid = (clerkTempValid ? 0 : 1) + (clerkTokensValid ? 0 : 1) + (clerkKeepAliveValid ? 0 : 1);
  const vectorInvalid = (memNValid ? 0 : 1) + (memKValid ? 0 : 1) + (memFlagsValid ? 0 : 1);

  const totalInvalid = actorInvalid + clerkInvalid + vectorInvalid;

  useEffect(() => {
    onInvalidChange?.(totalInvalid);
  }, [totalInvalid, onInvalidChange]);

  // Provider details
  const actorProvider = store.byId(actorSelection.providerId);
  const isActorOllama = !actorProvider || actorProvider.type === "ollama";

  const clerkProvider = store.byId(clerkSelection.providerId);
  const isClerkOllama = !clerkProvider || clerkProvider.type === "ollama";

  // Check if Clerk uses same model as Actor
  const normTag = (m: string) => {
    const c = (m || "").trim().toLowerCase();
    return c.endsWith(":latest") ? c.slice(0, -":latest".length).trim() : c;
  };
  const isSameModelAsActor =
    normTag(clerkSelection.model) === normTag(actorSelection.model) &&
    (clerkSelection.providerId ?? null) === (actorSelection.providerId ?? null);

  // Summaries
  const actorSummary = `Temp ${formatValue(actorTemp, 2)} · ${actorTokens} max tokens`;
  const clerkSummary = `Temp ${formatValue(clerkTemp, 2)} · ${clerkTokens} max tokens`;
  const vectorSummary = `Turns N=${workingMemoryTurns} · Chunks K=${episodicChunkSize} · Flags=${maxSceneFlags}`;

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
            </div>
          }
        />
      </div>
    </div>
  );
};
