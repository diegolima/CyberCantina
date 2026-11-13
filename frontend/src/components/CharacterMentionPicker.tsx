import React, { useEffect, useRef } from "react";
import { User, Radio } from "lucide-react";
import { CharacterRecord } from "../types";

export interface CharacterMentionPickerProps {
  isOpen: boolean;
  filterText: string;
  characters: CharacterRecord[];
  presentCharacterIds: string[];
  selectedIndex: number;
  onSelect: (character: CharacterRecord) => void;
  onClose: () => void;
  position?: { top: number; left: number };
}

export const CharacterMentionPicker: React.FC<CharacterMentionPickerProps> = ({
  isOpen,
  filterText,
  characters,
  presentCharacterIds,
  selectedIndex,
  onSelect,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const cleanFilter = filterText.trim().toLowerCase();
  const filtered = characters.filter((c) => {
    if (!cleanFilter) return true;
    return (
      c.name.toLowerCase().includes(cleanFilter) ||
      (c.tagline && c.tagline.toLowerCase().includes(cleanFilter))
    );
  });

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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

  if (!isOpen || filtered.length === 0) {
    return null;
  }

  return (
    <div className="mention-picker-popover" ref={containerRef}>
      <div className="mention-picker-header">
        <span className="mention-picker-title">Whisper to Character</span>
        <span className="mention-picker-shortcut">Tab or Enter to select</span>
      </div>
      <div className="mention-picker-list">
        {filtered.map((char, idx) => {
          const isPresent = presentCharacterIds.includes(char.id);
          const isSelected = idx === selectedIndex;
          return (
            <div
              key={char.id}
              className={`mention-picker-item ${isSelected ? "selected" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(char);
              }}
            >
              <div className="mention-picker-avatar">
                <User size={13} />
              </div>
              <div className="mention-picker-info">
                <div className="mention-picker-name-row">
                  <span className="mention-picker-name">@{char.name}</span>
                  {isPresent ? (
                    <span className="mention-badge-present" title="Present in current location">
                      <span className="presence-dot emerald" />
                      In Location
                    </span>
                  ) : (
                    <span className="mention-badge-remote" title="Elsewhere in campaign (Comms/Off-site)">
                      <Radio size={10} />
                      Comms
                    </span>
                  )}
                </div>
                {char.tagline && (
                  <div className="mention-picker-tagline">{char.tagline}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
