import React, { useCallback, useEffect, useId, useState } from "react";
import {
  Brain,
  Cpu,
  type LucideIcon,
  MessageSquare,
  RotateCcw,
  ScrollText,
} from "lucide-react";
import type { AgentDispatchMode, DisclosureDetectionMode } from "../../types";
import {
  BEHAVIOR_CARD_META,
  type BehaviorIconKey,
} from "../../utils/profilePreferences";
import { IntegerField } from "../models/IntegerField";

export interface ProfileBehaviorValues {
  workingMemoryTurns: number;
  minWorkingMemoryTurns: number;
  lodSummaryChunks: number;
  lodImportanceBonus: number;
  zone2BudgetSharePct: number;
  recallBudgetProseTokens: number;
  recallBudgetCognitionTokens: number;
  maxSceneFlags: number;
  agentDispatchMode: AgentDispatchMode;
  personaDisclosureMode: DisclosureDetectionMode;
  delegateCognitionToClerk: boolean;
}

export interface ProfileBehaviorCardsProps {
  values: ProfileBehaviorValues;
  defaults: ProfileBehaviorValues;
  isLocked: boolean;
  onChangeField: <K extends keyof ProfileBehaviorValues>(
    key: K,
    value: ProfileBehaviorValues[K],
    opts?: { immediate?: boolean }
  ) => void;
  onFieldBlurSettled?: () => void;
  onBehaviorInvalidChange?: (invalidCount: number) => void;
}

const CARD_ICONS: Record<BehaviorIconKey, LucideIcon> = {
  dialogue: MessageSquare,
  recaps: ScrollText,
  recall: Brain,
  engine: Cpu,
};

interface FieldResetButtonProps {
  fieldLabel: string;
  defaultDisplay: string;
  visible: boolean;
  onReset: () => void;
}

const FieldResetButton: React.FC<FieldResetButtonProps> = ({
  fieldLabel,
  defaultDisplay,
  visible,
  onReset,
}) => {
  if (!visible) return null;
  return (
    <button
      type="button"
      className="model-reset-btn"
      onClick={onReset}
      title={`Reset to system default (${defaultDisplay})`}
      aria-label={`Reset ${fieldLabel} to default (${defaultDisplay})`}
    >
      <RotateCcw size={12} />
    </button>
  );
};

function formatDispatchModeLabel(mode: AgentDispatchMode): string {
  return mode === "parallel" ? "Parallel" : "Sequential";
}

function formatDisclosureModeLabel(mode: DisclosureDetectionMode): string {
  if (mode === "token_matching") return "Token Matching";
  if (mode === "hybrid") return "Hybrid";
  return "LLM Intent";
}

/** 4 static Zone & Engine cards for the Preferences -> Behavior sub-tab. */
export const ProfileBehaviorCards: React.FC<ProfileBehaviorCardsProps> = ({
  values,
  defaults,
  isLocked,
  onChangeField,
  onFieldBlurSettled,
  onBehaviorInvalidChange,
}) => {
  const dispatchSelectId = useId();
  const disclosureSelectId = useId();
  const delegateCheckboxId = useId();

  const [invalidMap, setInvalidMap] = useState<Record<string, boolean>>({});

  const setFieldValidity = useCallback((fieldKey: string, valid: boolean) => {
    setInvalidMap((prev) => {
      const wasInvalid = Boolean(prev[fieldKey]);
      const isInvalid = !valid;
      if (wasInvalid === isInvalid) return prev;
      return { ...prev, [fieldKey]: isInvalid };
    });
  }, []);

  useEffect(() => {
    const count = Object.values(invalidMap).filter(Boolean).length;
    onBehaviorInvalidChange?.(count);
  }, [invalidMap, onBehaviorInvalidChange]);

  const cardMap = Object.fromEntries(
    BEHAVIOR_CARD_META.map((meta) => [meta.id, meta])
  ) as Record<BehaviorIconKey, (typeof BEHAVIOR_CARD_META)[number]>;

  const renderCardHeader = (id: BehaviorIconKey) => {
    const meta = cardMap[id];
    const Icon = CARD_ICONS[id];
    return (
      <div className="behavior-card-header">
        <div
          className="behavior-card-icon-box"
          style={{ "--card-accent-color": meta.accent } as React.CSSProperties}
        >
          <Icon size={16} />
        </div>
        <div className="behavior-card-title-block">
          <div className="behavior-card-title">{meta.title}</div>
          <div className="behavior-card-subtitle">{meta.subtitle}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="behavior-cards-grid">
      {/* 1. Recent Dialogue (Working Memory · Zone 3) */}
      <section
        className="behavior-card"
        style={{ "--card-accent-color": cardMap.dialogue.accent } as React.CSSProperties}
      >
        {renderCardHeader("dialogue")}
        <div className="behavior-card-fields">
          <IntegerField
            label="Verbatim Turns (N)"
            value={values.workingMemoryTurns}
            min={4}
            max={64}
            disabled={isLocked}
            hint="Number of recent turns kept verbatim before older dialogue condenses into recaps."
            onCommit={(v) => onChangeField("workingMemoryTurns", v)}
            onBlurSettled={onFieldBlurSettled}
            onValidityChange={(valid) => setFieldValidity("workingMemoryTurns", valid)}
            labelAction={
              <FieldResetButton
                fieldLabel="Verbatim Turns (N)"
                defaultDisplay={String(defaults.workingMemoryTurns)}
                visible={!isLocked && values.workingMemoryTurns !== defaults.workingMemoryTurns}
                onReset={() =>
                  onChangeField("workingMemoryTurns", defaults.workingMemoryTurns, {
                    immediate: true,
                  })
                }
              />
            }
          />
          <IntegerField
            label="Min Protected Turns"
            value={values.minWorkingMemoryTurns}
            min={1}
            max={32}
            disabled={isLocked}
            hint="Floor of verbatim recent turns protected from overflow trimming before recaps degrade."
            onCommit={(v) => onChangeField("minWorkingMemoryTurns", v)}
            onBlurSettled={onFieldBlurSettled}
            onValidityChange={(valid) => setFieldValidity("minWorkingMemoryTurns", valid)}
            labelAction={
              <FieldResetButton
                fieldLabel="Min Protected Turns"
                defaultDisplay={String(defaults.minWorkingMemoryTurns)}
                visible={
                  !isLocked &&
                  values.minWorkingMemoryTurns !== defaults.minWorkingMemoryTurns
                }
                onReset={() =>
                  onChangeField("minWorkingMemoryTurns", defaults.minWorkingMemoryTurns, {
                    immediate: true,
                  })
                }
              />
            }
          />
        </div>
      </section>

      {/* 2. Story Recaps (Episodic Summaries · Zone 2) */}
      <section
        className="behavior-card"
        style={{ "--card-accent-color": cardMap.recaps.accent } as React.CSSProperties}
      >
        {renderCardHeader("recaps")}
        <div className="behavior-card-fields">
          <IntegerField
            label="Full Summary Chunks"
            value={values.lodSummaryChunks}
            min={1}
            max={32}
            disabled={isLocked}
            hint="Newest or pivotal recaps kept as full paragraphs before older ones shrink to 1-line synopses."
            onCommit={(v) => onChangeField("lodSummaryChunks", v)}
            onBlurSettled={onFieldBlurSettled}
            onValidityChange={(valid) => setFieldValidity("lodSummaryChunks", valid)}
            labelAction={
              <FieldResetButton
                fieldLabel="Full Summary Chunks"
                defaultDisplay={String(defaults.lodSummaryChunks)}
                visible={!isLocked && values.lodSummaryChunks !== defaults.lodSummaryChunks}
                onReset={() =>
                  onChangeField("lodSummaryChunks", defaults.lodSummaryChunks, {
                    immediate: true,
                  })
                }
              />
            }
          />
          <IntegerField
            label="High-Salience Bonus"
            value={values.lodImportanceBonus}
            min={0}
            max={10}
            disabled={isLocked}
            hint="Extra retention priority given to pivotal high-salience (≥8) story recaps."
            onCommit={(v) => onChangeField("lodImportanceBonus", v)}
            onBlurSettled={onFieldBlurSettled}
            onValidityChange={(valid) => setFieldValidity("lodImportanceBonus", valid)}
            labelAction={
              <FieldResetButton
                fieldLabel="High-Salience Bonus"
                defaultDisplay={String(defaults.lodImportanceBonus)}
                visible={!isLocked && values.lodImportanceBonus !== defaults.lodImportanceBonus}
                onReset={() =>
                  onChangeField("lodImportanceBonus", defaults.lodImportanceBonus, {
                    immediate: true,
                  })
                }
              />
            }
          />
          <IntegerField
            label="History Budget Share (%)"
            value={values.zone2BudgetSharePct}
            min={10}
            max={80}
            disabled={isLocked}
            hint="Maximum share of available history token budget allocated to story recaps."
            onCommit={(v) => onChangeField("zone2BudgetSharePct", v)}
            onBlurSettled={onFieldBlurSettled}
            onValidityChange={(valid) => setFieldValidity("zone2BudgetSharePct", valid)}
            labelAction={
              <FieldResetButton
                fieldLabel="History Budget Share (%)"
                defaultDisplay={`${defaults.zone2BudgetSharePct}%`}
                visible={!isLocked && values.zone2BudgetSharePct !== defaults.zone2BudgetSharePct}
                onReset={() =>
                  onChangeField("zone2BudgetSharePct", defaults.zone2BudgetSharePct, {
                    immediate: true,
                  })
                }
              />
            }
          />
        </div>
      </section>

      {/* 3. Long-Term Recall (Vector Memory & Lore) */}
      <section
        className="behavior-card"
        style={{ "--card-accent-color": cardMap.recall.accent } as React.CSSProperties}
      >
        {renderCardHeader("recall")}
        <div className="behavior-card-fields">
          <IntegerField
            label="Story Prose Recall Budget (tokens)"
            value={values.recallBudgetProseTokens}
            min={100}
            max={2000}
            disabled={isLocked}
            hint="Token budget for recalled memories and lorebook entries injected into Phase 4 prose (Zone 4)."
            onCommit={(v) => onChangeField("recallBudgetProseTokens", v)}
            onBlurSettled={onFieldBlurSettled}
            onValidityChange={(valid) => setFieldValidity("recallBudgetProseTokens", valid)}
            labelAction={
              <FieldResetButton
                fieldLabel="Story Prose Recall Budget (tokens)"
                defaultDisplay={String(defaults.recallBudgetProseTokens)}
                visible={
                  !isLocked &&
                  values.recallBudgetProseTokens !== defaults.recallBudgetProseTokens
                }
                onReset={() =>
                  onChangeField(
                    "recallBudgetProseTokens",
                    defaults.recallBudgetProseTokens,
                    { immediate: true }
                  )
                }
              />
            }
          />
          <IntegerField
            label="Character Cognition Recall Budget (tokens)"
            value={values.recallBudgetCognitionTokens}
            min={60}
            max={1000}
            disabled={isLocked}
            hint="Token budget for private memories recalled during Phase 3 character cognition."
            onCommit={(v) => onChangeField("recallBudgetCognitionTokens", v)}
            onBlurSettled={onFieldBlurSettled}
            onValidityChange={(valid) => setFieldValidity("recallBudgetCognitionTokens", valid)}
            labelAction={
              <FieldResetButton
                fieldLabel="Character Cognition Recall Budget (tokens)"
                defaultDisplay={String(defaults.recallBudgetCognitionTokens)}
                visible={
                  !isLocked &&
                  values.recallBudgetCognitionTokens !==
                    defaults.recallBudgetCognitionTokens
                }
                onReset={() =>
                  onChangeField(
                    "recallBudgetCognitionTokens",
                    defaults.recallBudgetCognitionTokens,
                    { immediate: true }
                  )
                }
              />
            }
          />
        </div>
      </section>

      {/* 4. Scene State & Turn Engine (Simulation & Pipeline · Zone 4) */}
      <section
        className="behavior-card"
        style={{ "--card-accent-color": cardMap.engine.accent } as React.CSSProperties}
      >
        {renderCardHeader("engine")}
        <div className="behavior-card-fields">
          <IntegerField
            label="Max Active Scene Flags"
            value={values.maxSceneFlags}
            min={1}
            max={50}
            disabled={isLocked}
            hint="Sliding FIFO cap on active scene condition flags tracked in world snapshots."
            onCommit={(v) => onChangeField("maxSceneFlags", v)}
            onBlurSettled={onFieldBlurSettled}
            onValidityChange={(valid) => setFieldValidity("maxSceneFlags", valid)}
            labelAction={
              <FieldResetButton
                fieldLabel="Max Active Scene Flags"
                defaultDisplay={String(defaults.maxSceneFlags)}
                visible={!isLocked && values.maxSceneFlags !== defaults.maxSceneFlags}
                onReset={() =>
                  onChangeField("maxSceneFlags", defaults.maxSceneFlags, {
                    immediate: true,
                  })
                }
              />
            }
          />

          <div className="form-group">
            <div className="behavior-field-label-row">
              <label className="form-label" htmlFor={dispatchSelectId}>
                Character Agent Dispatch Mode
              </label>
              <FieldResetButton
                fieldLabel="Character Agent Dispatch Mode"
                defaultDisplay={formatDispatchModeLabel(defaults.agentDispatchMode)}
                visible={!isLocked && values.agentDispatchMode !== defaults.agentDispatchMode}
                onReset={() =>
                  onChangeField("agentDispatchMode", defaults.agentDispatchMode, {
                    immediate: true,
                  })
                }
              />
            </div>
            <select
              id={dispatchSelectId}
              className="field-select"
              disabled={isLocked}
              value={values.agentDispatchMode}
              onChange={(e) =>
                onChangeField(
                  "agentDispatchMode",
                  e.target.value as AgentDispatchMode,
                  { immediate: true }
                )
              }
            >
              <option value="sequential">
                Sequential — One-at-a-Time (Single Local GPU / Ollama)
              </option>
              <option value="parallel">
                Parallel — Concurrent Dispatch (Cloud APIs / Multi-Slot vLLM)
              </option>
            </select>
            <div className="form-hint" style={{ fontSize: "0.7rem" }}>
              Sequential avoids local GPU contention; Parallel runs ensemble characters concurrently.
            </div>
          </div>

          <div className="form-group">
            <div className="behavior-field-label-row">
              <label className="form-label" htmlFor={disclosureSelectId}>
                Persona Disclosure Detection Strategy
              </label>
              <FieldResetButton
                fieldLabel="Persona Disclosure Detection Strategy"
                defaultDisplay={formatDisclosureModeLabel(
                  defaults.personaDisclosureMode
                )}
                visible={
                  !isLocked &&
                  values.personaDisclosureMode !== defaults.personaDisclosureMode
                }
                onReset={() =>
                  onChangeField(
                    "personaDisclosureMode",
                    defaults.personaDisclosureMode,
                    { immediate: true }
                  )
                }
              />
            </div>
            <select
              id={disclosureSelectId}
              className="field-select"
              disabled={isLocked}
              value={values.personaDisclosureMode}
              onChange={(e) =>
                onChangeField(
                  "personaDisclosureMode",
                  e.target.value as DisclosureDetectionMode,
                  { immediate: true }
                )
              }
            >
              <option value="llm_intent">
                LLM Intent (Semantic Phase 1 Analysis)
              </option>
              <option value="token_matching">
                Token Matching (Fast Deterministic Keywords)
              </option>
              <option value="hybrid">
                Hybrid (Token Matching + Semantic LLM)
              </option>
            </select>
            <div className="form-hint" style={{ fontSize: "0.7rem" }}>
              Controls how player persona secrets and revelations are detected each turn.
            </div>
          </div>

          <div className="form-group">
            <div className="behavior-field-label-row">
              <label
                className="behavior-toggle-label"
                htmlFor={delegateCheckboxId}
              >
                <input
                  id={delegateCheckboxId}
                  type="checkbox"
                  checked={values.delegateCognitionToClerk}
                  disabled={isLocked}
                  onChange={(e) =>
                    onChangeField("delegateCognitionToClerk", e.target.checked, {
                      immediate: true,
                    })
                  }
                />
                <span>Delegate Cognition to Clerk</span>
              </label>
              <FieldResetButton
                fieldLabel="Delegate Cognition to Clerk"
                defaultDisplay={defaults.delegateCognitionToClerk ? "On" : "Off"}
                visible={
                  !isLocked &&
                  values.delegateCognitionToClerk !==
                    defaults.delegateCognitionToClerk
                }
                onReset={() =>
                  onChangeField(
                    "delegateCognitionToClerk",
                    defaults.delegateCognitionToClerk,
                    { immediate: true }
                  )
                }
              />
            </div>
            <div className="form-hint" style={{ fontSize: "0.7rem" }}>
              Run Phase 3 character inner-thought cognition on the lighter Clerk model instead of the Actor model.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
