import React from "react";
import { HelpCircle, X } from "lucide-react";
import type { ActiveSlashCommand } from "../../types";
import {
  getCommandAvailability,
  getPartySubcommandAvailability,
  SLASH_COMMANDS,
  type SlashCommandAvailabilityContext,
} from "../../utils/slashCommands";
import { SlashCommandIcon } from "./SlashCommandPicker";

export interface SlashHelpTrayProps {
  availabilityContext: SlashCommandAvailabilityContext;
  onInsertCommand: (cmd: ActiveSlashCommand) => void;
  onClose: () => void;
}

export const SlashHelpTray: React.FC<SlashHelpTrayProps> = ({
  availabilityContext,
  onInsertCommand,
  onClose,
}) => {
  return (
    <div
      className="slash-help-tray"
      role="region"
      aria-label="Slash Commands Reference"
    >
      <div className="slash-help-header">
        <div className="slash-help-title">
          <HelpCircle size={14} color="var(--accent-cyan)" />
          <span>Slash Commands &amp; Composer Shortcuts</span>
        </div>
        <button
          type="button"
          className="btn"
          style={{ padding: "2px 6px", border: "none" }}
          onClick={onClose}
          aria-label="Close slash help"
          title="Close (Escape)"
        >
          <X size={13} />
        </button>
      </div>

      <div className="slash-help-list">
        {SLASH_COMMANDS.map((spec) => {
          const avail = getCommandAvailability(spec.id, availabilityContext);
          return (
            <div key={spec.id} className="slash-help-item-wrap">
              <button
                type="button"
                className={`slash-help-row ${
                  !avail.available ? "slash-help-row--disabled" : ""
                }`}
                disabled={!avail.available}
                onClick={() =>
                  onInsertCommand({ command: spec.id, subcommand: null })
                }
                title={
                  avail.available
                    ? `Insert /${spec.name} into composer`
                    : avail.reason ?? undefined
                }
              >
                <span
                  className={`slash-picker-icon slash-picker-icon--${spec.accent}`}
                >
                  <SlashCommandIcon iconKey={spec.iconKey} size={13} />
                </span>
                <div className="slash-help-row-body">
                  <div className="slash-help-row-top">
                    <span className="slash-help-cmd">/{spec.name}</span>
                    {spec.aliases.length > 0 && (
                      <span className="slash-help-aliases">
                        {spec.aliases.map((a) => `/${a}`).join(", ")}
                      </span>
                    )}
                    <code className="slash-help-syntax">{spec.syntax}</code>
                    {!avail.available && avail.reason && (
                      <span className="slash-picker-reason">{avail.reason}</span>
                    )}
                  </div>
                  <div className="slash-help-desc">{spec.description}</div>
                </div>
              </button>

              {spec.subcommands && spec.subcommands.length > 0 && (
                <div className="slash-help-subcmds">
                  <span className="slash-help-subcmds-label">Subcommands:</span>
                  {spec.subcommands.map((sub) => {
                    const subAvail = getPartySubcommandAvailability(
                      sub.id,
                      availabilityContext
                    );
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        className={`slash-help-subcmd-btn ${
                          !subAvail.available
                            ? "slash-help-subcmd-btn--disabled"
                            : ""
                        }`}
                        disabled={!subAvail.available}
                        onClick={() =>
                          onInsertCommand({
                            command: "party",
                            subcommand: sub.id,
                          })
                        }
                        title={
                          subAvail.available
                            ? `${sub.syntax} — ${sub.description}`
                            : `${sub.syntax} (${subAvail.reason})`
                        }
                      >
                        <span>{sub.label}</span>
                        {!subAvail.available && subAvail.reason && (
                          <span className="slash-help-subcmd-reason">
                            · {subAvail.reason}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="slash-help-footer">
        <span className="slash-help-footer-title">Also in Composer:</span>
        <span className="slash-help-footer-item">
          <code>@Character: &quot;spoken&quot; sensory</code> Private whisper or
          remote comms
        </span>
        <span className="slash-help-footer-item">
          <code>/choice</code> gates: <code>@any</code> <code>@crit</code>{" "}
          <code>@success</code> <code>@fail</code> <code>@critfail</code>
        </span>
      </div>
    </div>
  );
};
