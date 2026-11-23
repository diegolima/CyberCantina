import React, { useEffect, useRef } from "react";
import {
  Clock,
  Compass,
  Eye,
  HelpCircle,
  ListChecks,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import type { SlashCommandIconKey } from "../../types";
import type { SlashPickerItem } from "../../utils/slashCommands";

export interface SlashCommandIconProps {
  iconKey: SlashCommandIconKey;
  size?: number;
  className?: string;
}

export const SlashCommandIcon: React.FC<SlashCommandIconProps> = ({
  iconKey,
  size = 13,
  className,
}) => {
  switch (iconKey) {
    case "list_checks":
      return <ListChecks size={size} className={className} />;
    case "zap":
      return <Zap size={size} className={className} />;
    case "compass":
      return <Compass size={size} className={className} />;
    case "help_circle":
      return <HelpCircle size={size} className={className} />;
    case "eye":
      return <Eye size={size} className={className} />;
    case "sparkles":
      return <Sparkles size={size} className={className} />;
    case "users":
      return <Users size={size} className={className} />;
    case "clock":
      return <Clock size={size} className={className} />;
  }
};

export interface SlashCommandPickerProps {
  isOpen: boolean;
  stage: "command" | "subcommand";
  items: SlashPickerItem[];
  selectedIndex: number;
  onSelect: (item: SlashPickerItem) => void;
  onHoverIndex?: (index: number) => void;
  onClose: () => void;
}

export const SlashCommandPicker: React.FC<SlashCommandPickerProps> = ({
  isOpen,
  stage,
  items,
  selectedIndex,
  onSelect,
  onHoverIndex,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen || items.length === 0) {
    return null;
  }

  return (
    <div
      className="ui-popover mention-picker-popover slash-picker-popover"
      ref={containerRef}
    >
      <div className="mention-picker-header">
        <span className="mention-picker-title">
          {stage === "subcommand" ? "/party Subcommands" : "Slash Commands"}
        </span>
        <span className="mention-picker-shortcut">Tab or Enter to select</span>
      </div>
      <div className="mention-picker-list slash-picker-list" role="listbox">
        {items.map((item, idx) => {
          const isSelected = item.available && idx === selectedIndex;
          return (
            <div
              key={item.key}
              role="option"
              aria-selected={isSelected}
              aria-disabled={!item.available}
              className={`mention-picker-item slash-picker-item ${
                isSelected ? "selected" : ""
              } ${!item.available ? "slash-picker-item--disabled" : ""}`}
              onMouseEnter={() => {
                if (item.available) {
                  onHoverIndex?.(idx);
                }
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                if (item.available) {
                  onSelect(item);
                }
              }}
            >
              <div
                className={`slash-picker-icon slash-picker-icon--${item.accent}`}
              >
                <SlashCommandIcon iconKey={item.iconKey} size={13} />
              </div>
              <div className="slash-picker-main">
                <div className="slash-picker-top-row">
                  <span className="slash-picker-cmd">
                    {item.stage === "command" ? `/${item.label}` : item.label}
                  </span>
                  {item.matchedAlias && (
                    <span className="slash-picker-alias-badge">
                      alias: /{item.matchedAlias}
                    </span>
                  )}
                  {item.syntax && (
                    <code className="slash-picker-syntax">{item.syntax}</code>
                  )}
                  {!item.available && item.unavailableReason && (
                    <span className="slash-picker-reason">
                      {item.unavailableReason}
                    </span>
                  )}
                </div>
                <div className="slash-picker-desc">{item.description}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
