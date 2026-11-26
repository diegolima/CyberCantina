import React from "react";
import { Dices, ListChecks, Plus, Sparkles, Trash2, X } from "lucide-react";
import type {
  CharacterChoiceOption,
  CharacterChoiceSet,
  CharacterRecord,
  ChoiceGate,
  ChoicePreviewResponse,
  DiceMode,
  MechanicsTopicId,
} from "../../types";
import { MechanicsHelpButton } from "../shared/MechanicsHelpButton";
import {
  DEFAULT_GATE_DC,
  MAX_CHOICE_LABEL_LENGTH,
  MAX_CHOICE_OPTIONS,
} from "../../types";

export interface DirectorChoicesDrawerProps {
  presentCharacters: CharacterRecord[];
  stagedChoices: Record<string, CharacterChoiceSet>;
  activeChoiceCharId: string;
  setActiveChoiceCharId: (id: string) => void;
  activeCharRecord: CharacterRecord | undefined;
  totalStagedOptionsCount: number;
  diceMode: DiceMode;
  choicePreview: ChoicePreviewResponse | null;
  onClearAll: () => void;
  onClearChar: (charId: string) => void;
  onSetDC: (charId: string, dc: number) => void;
  onAddOption: (charId: string) => void;
  onUpdateOption: (
    charId: string,
    optId: string,
    patch: Partial<CharacterChoiceOption>
  ) => void;
  onRemoveOption: (charId: string, optId: string) => void;
  onClose: () => void;
  onOpenMechanicsHelp?: (topicId: MechanicsTopicId) => void;
}

export const DirectorChoicesDrawer: React.FC<DirectorChoicesDrawerProps> = ({
  presentCharacters,
  stagedChoices,
  activeChoiceCharId,
  setActiveChoiceCharId,
  activeCharRecord,
  totalStagedOptionsCount,
  diceMode,
  choicePreview,
  onClearAll,
  onClearChar,
  onSetDC,
  onAddOption,
  onUpdateOption,
  onRemoveOption,
  onClose,
  onOpenMechanicsHelp,
}) => {
  const handleClearAllChoices = onClearAll;
  const handleClearCharChoices = onClearChar;
  const handleSetDC = onSetDC;
  const handleAddOption = onAddOption;
  const handleUpdateOption = onUpdateOption;
  const handleRemoveOption = onRemoveOption;
  const setActiveTray = (_: string) => onClose();

  return (
          <div className="choices-drawer-box">
            <div className="choices-drawer-header">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  color: "var(--emerald-fg)",
                  fontWeight: 600,
                  fontSize: "0.78rem",
                }}
              >
                <ListChecks size={14} />
                <span>Director Choices (Guide Character Cognition)</span>
                <MechanicsHelpButton
                  topicId="dice-director-choices"
                  label="Director Choices"
                  onOpenHelp={onOpenMechanicsHelp}
                />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {totalStagedOptionsCount > 0 && (
                  <button
                    type="button"
                    className="btn"
                    style={{
                      padding: "2px 8px",
                      fontSize: "0.70rem",
                      color: "var(--accent-rose)",
                      border: "none",
                    }}
                    onClick={handleClearAllChoices}
                  >
                    Clear All
                  </button>
                )}
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "2px 6px", border: "none" }}
                  aria-label="Close Director Choices"
                  onClick={() => setActiveTray("none")}
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {presentCharacters.length === 0 ? (
              <div
                style={{
                  padding: "10px 4px",
                  fontSize: "0.78rem",
                  color: "var(--text-muted)",
                }}
              >
                No characters present in this location to guide.
              </div>
            ) : (
              <>
            {/* Character selection tabs */}
            <div className="choices-char-tabs">
              {presentCharacters.map((c) => {
                const isSelected = c.id === activeChoiceCharId;
                const optCount = stagedChoices[c.id]?.options?.length || 0;
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={`choices-char-tab ${
                      isSelected ? "choices-char-tab--active" : ""
                    }`}
                    onClick={() => setActiveChoiceCharId(c.id)}
                  >
                    <span>{c.name}</span>
                    {optCount > 0 && (
                      <span
                        style={{
                          fontSize: "0.64rem",
                          background: isSelected
                            ? "var(--accent-emerald)"
                            : "var(--surface-glass-4)",
                          color: isSelected
                            ? "var(--bg-deep)"
                            : "var(--text-primary)",
                          padding: "0 5px",
                          borderRadius: 8,
                          fontWeight: 700,
                        }}
                      >
                        {optCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* DC preset and input row for active character */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                fontSize: "0.74rem",
              }}
            >
              <span
                style={{
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Dices size={12} />
                Gate DC:
              </span>
              {[
                { label: "Easy 8", val: 8 },
                { label: "Moderate 12", val: 12 },
                { label: "Hard 15", val: 15 },
                { label: "Very Hard 18", val: 18 },
              ].map((preset) => {
                const currentDC =
                  stagedChoices[activeChoiceCharId]?.gate_difficulty_class ??
                  DEFAULT_GATE_DC;
                const isSelected = currentDC === preset.val;
                return (
                  <button
                    key={preset.val}
                    type="button"
                    className="btn"
                    style={{
                      padding: "2px 7px",
                      fontSize: "0.70rem",
                      background: isSelected
                        ? "var(--emerald-bg-hover)"
                        : undefined,
                      borderColor: isSelected
                        ? "var(--accent-emerald)"
                        : undefined,
                      color: isSelected
                        ? "var(--emerald-fg)"
                        : "var(--text-secondary)",
                    }}
                    onClick={() => handleSetDC(activeChoiceCharId, preset.val)}
                  >
                    {preset.label}
                  </button>
                );
              })}
              <input
                type="number"
                min={1}
                max={30}
                value={
                  stagedChoices[activeChoiceCharId]?.gate_difficulty_class ??
                  DEFAULT_GATE_DC
                }
                onChange={(e) => {
                  const num = parseInt(e.target.value, 10);
                  if (!isNaN(num) && num >= 1 && num <= 30) {
                    handleSetDC(activeChoiceCharId, num);
                  }
                }}
                className="field-input choices-dc-input"
                style={{ width: 50, padding: "2px 6px", fontSize: "0.72rem" }}
                title="Custom gate difficulty class (1-30)"
              />
              {stagedChoices[activeChoiceCharId]?.options?.length ? (
                <button
                  type="button"
                  className="btn"
                  style={{
                    marginLeft: "auto",
                    padding: "2px 7px",
                    fontSize: "0.70rem",
                    color: "var(--text-muted)",
                  }}
                  onClick={() => handleClearCharChoices(activeChoiceCharId)}
                >
                  Clear {activeCharRecord?.name || "character"} choices
                </button>
              ) : null}
            </div>

            {/* Options list for active character */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(stagedChoices[activeChoiceCharId]?.options || []).map(
                (opt, idx) => {
                  const isGated = opt.gate && opt.gate !== "any";
                  let oddsLabel: string | null = null;
                  if (isGated && choicePreview?.gate_probabilities) {
                    const prob =
                      choicePreview.gate_probabilities[opt.gate as ChoiceGate];
                    if (typeof prob === "number") {
                      oddsLabel = `${Math.round(prob * 100)}%`;
                    }
                  }

                  return (
                    <div key={opt.id} className="choices-option-row">
                      <div className="choices-option-main">
                        <span
                          style={{
                            fontSize: "0.72rem",
                            color: "var(--text-muted)",
                            width: 14,
                            flexShrink: 0,
                          }}
                        >
                          {idx + 1}.
                        </span>
                        <input
                          type="text"
                          className="choices-option-input"
                          placeholder="Choice label (e.g. Open the blast door, Back away slowly...)"
                          value={opt.label}
                          maxLength={MAX_CHOICE_LABEL_LENGTH}
                          onChange={(e) =>
                            handleUpdateOption(activeChoiceCharId, opt.id, {
                              label: e.target.value.slice(0, MAX_CHOICE_LABEL_LENGTH),
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleAddOption(activeChoiceCharId);
                            }
                          }}
                        />
                        <span
                          className={`choices-char-count ${
                            opt.label.length >= MAX_CHOICE_LABEL_LENGTH
                              ? "choices-char-count--limit"
                              : ""
                          }`}
                          title={`Character limit: ${opt.label.length}/${MAX_CHOICE_LABEL_LENGTH}`}
                        >
                          {opt.label.length}/{MAX_CHOICE_LABEL_LENGTH}
                        </span>
                      </div>

                      <div className="choices-option-meta">
                        <select
                          className="choices-gate-select"
                          value={opt.gate || "any"}
                          onChange={(e) =>
                            handleUpdateOption(activeChoiceCharId, opt.id, {
                              gate: e.target.value as ChoiceGate,
                            })
                          }
                        >
                          <option value="any">Always Available (No Gate)</option>
                          <option value="critical_success">
                            Req: Critical Success (d20=20 or DC+10)
                          </option>
                          <option value="success_plus">
                            Req: Success or better (DC met)
                          </option>
                          <option value="failure_minus">
                            Req: Failure or worse (&lt; DC)
                          </option>
                          <option value="critical_failure">
                            Req: Critical Failure (d20=1 or DC-10)
                          </option>
                        </select>

                        {isGated && oddsLabel && (
                          <span
                            className="choices-odds-badge"
                            style={{
                              background: "var(--emerald-bg)",
                              border: "1px solid var(--emerald-border)",
                              color: "var(--emerald-fg)",
                            }}
                            title={`Estimated odds under current DC (${
                              stagedChoices[activeChoiceCharId]
                                ?.gate_difficulty_class ?? DEFAULT_GATE_DC
                            }) and dice mode`}
                          >
                            {oddsLabel} odds
                          </span>
                        )}

                        <button
                          type="button"
                          className="btn choices-option-remove-btn"
                          style={{
                            padding: "3px 6px",
                            border: "none",
                            color: "var(--accent-rose)",
                          }}
                          onClick={() =>
                            handleRemoveOption(activeChoiceCharId, opt.id)
                          }
                          aria-label="Remove option"
                          title="Remove option"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                }
              )}
            </div>

            {/* Add option button & summary banner */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="btn"
                style={{
                  padding: "4px 12px",
                  fontSize: "0.72rem",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
                disabled={
                  (stagedChoices[activeChoiceCharId]?.options?.length || 0) >=
                  MAX_CHOICE_OPTIONS
                }
                onClick={() => handleAddOption(activeChoiceCharId)}
                title={
                  (stagedChoices[activeChoiceCharId]?.options?.length || 0) >=
                  MAX_CHOICE_OPTIONS
                    ? `Maximum of ${MAX_CHOICE_OPTIONS} choices reached`
                    : undefined
                }
              >
                <Plus size={12} />
                <span>
                  Add Choice for {activeCharRecord?.name || "Character"}
                  {stagedChoices[activeChoiceCharId]?.options?.length
                    ? ` (${stagedChoices[activeChoiceCharId]?.options?.length}/${MAX_CHOICE_OPTIONS})`
                    : ""}
                </span>
              </button>

              <span style={{ fontSize: "0.70rem", color: "var(--text-muted)" }}>
                Tip: You can also type{" "}
                <code>
                  /choice {activeCharRecord?.name || "name"}: Opt 1 | Opt 2
                  @crit
                </code>
              </span>
            </div>

            {/* Preview Summary Banner */}
            {choicePreview &&
              (stagedChoices[activeChoiceCharId]?.options?.length || 0) > 0 && (
                <div className="choices-preview-summary">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <Sparkles size={12} color="var(--emerald-fg)" />
                    <span>
                      Odds distribution for DC {choicePreview.difficulty_class} (
                      {diceMode} dice):
                    </span>
                    {choicePreview.tier_probabilities &&
                      Object.entries(choicePreview.tier_probabilities).map(
                        ([tier, prob]) => (
                          <span key={tier} style={{ opacity: 0.85 }}>
                            {tier}: <strong>{Math.round(prob * 100)}%</strong>
                          </span>
                        )
                      )}
                  </div>
                  <div>
                    {stagedChoices[activeChoiceCharId]?.options.some(
                      (o) => !o.gate || o.gate === "any"
                    ) ? (
                      <span style={{ color: "#86efac" }}>
                        ✓ Always-available option present
                      </span>
                    ) : (
                      <span
                        style={{ color: "#fde047" }}
                        title="If the roll misses all gated options, the character will decide freely without guidance."
                      >
                        ○ Free fallback if roll conditions fail
                      </span>
                    )}
                  </div>
                </div>
              )}
              </>
            )}
          </div>
  );
};
