import React, { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, MapPin, Users } from "lucide-react";
import type { LocationOverrideOptions } from "../../types";
import { getLocationOverridePrimaryLabel } from "../../utils/partyHelpers";

export interface LocationOverrideButtonProps {
  targetLocationId: string;
  targetLocationName?: string;
  coLocatedPartyNpcs: Array<{ id: string; name: string }>;
  disabled?: boolean;
  isPending?: boolean;
  compact?: boolean;
  className?: string;
  onOverride: (
    locationId: string,
    options?: LocationOverrideOptions
  ) => void | Promise<void>;
}

export const LocationOverrideButton: React.FC<LocationOverrideButtonProps> = ({
  targetLocationId,
  targetLocationName,
  coLocatedPartyNpcs,
  disabled = false,
  isPending = false,
  compact = false,
  className = "",
  onOverride,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSubsetPicker, setShowSubsetPicker] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasCoLocatedParty = coLocatedPartyNpcs.length > 0;
  const primaryLabel = isPending
    ? "Relocating..."
    : getLocationOverridePrimaryLabel(hasCoLocatedParty);

  useEffect(() => {
    setMenuOpen(false);
    setShowSubsetPicker(false);
    setSelectedIds([]);
  }, [targetLocationId, coLocatedPartyNpcs.length]);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  const toggleNpc = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  if (!hasCoLocatedParty) {
    return (
      <button
        type="button"
        className={`btn btn-secondary location-override-single ${className}`.trim()}
        disabled={disabled}
        onClick={() => onOverride(targetLocationId, { move_mode: "party" })}
        title={
          targetLocationName
            ? `Override current scene location to ${targetLocationName}`
            : "Override current scene location"
        }
        style={
          compact
            ? { fontSize: "0.74rem", padding: "5px 9px", width: "100%" }
            : undefined
        }
      >
        <MapPin size={12} />
        <span>{primaryLabel}</span>
      </button>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`location-override-split ${className}`.trim()}
    >
      <div className="location-override-split-group">
        <button
          type="button"
          className="btn btn-secondary location-override-primary"
          disabled={disabled}
          onClick={() => {
            setMenuOpen(false);
            void onOverride(targetLocationId, { move_mode: "party" });
          }}
          title={
            targetLocationName
              ? `Move you and co-located party members to ${targetLocationName}`
              : "Move you and co-located party members"
          }
          style={
            compact ? { fontSize: "0.74rem", padding: "5px 9px" } : undefined
          }
        >
          <Users size={12} />
          <span>{primaryLabel}</span>
        </button>
        <button
          type="button"
          className="btn btn-secondary location-override-caret"
          disabled={disabled}
          aria-label="Override movement options"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
          style={
            compact ? { fontSize: "0.74rem", padding: "5px 7px" } : undefined
          }
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {menuOpen && (
        <div className="location-override-menu" role="menu">
          <button
            type="button"
            className="location-override-menu-item"
            role="menuitem"
            disabled={disabled}
            onClick={() => {
              setMenuOpen(false);
              setShowSubsetPicker(false);
              void onOverride(targetLocationId, { move_mode: "alone" });
            }}
          >
            <span style={{ fontWeight: 600 }}>Move Alone</span>
            <span className="location-override-menu-sub">
              Leave co-located party members behind
            </span>
          </button>

          <button
            type="button"
            className="location-override-menu-item"
            role="menuitem"
            disabled={disabled}
            onClick={() => setShowSubsetPicker((prev) => !prev)}
          >
            <span style={{ fontWeight: 600 }}>Move Selected...</span>
            <span className="location-override-menu-sub">
              Choose which companions come with you
            </span>
          </button>

          {showSubsetPicker && (
            <div className="location-override-subset">
              {coLocatedPartyNpcs.map((npc) => {
                const checked = selectedIds.includes(npc.id);
                return (
                  <label
                    key={npc.id}
                    className="location-override-subset-row"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleNpc(npc.id)}
                    />
                    <span>{npc.name}</span>
                    {checked && <Check size={11} color="var(--accent-emerald)" />}
                  </label>
                );
              })}
              <button
                type="button"
                className="btn btn-primary"
                disabled={disabled}
                style={{
                  width: "100%",
                  fontSize: "0.72rem",
                  padding: "5px 8px",
                  marginTop: 4,
                }}
                onClick={() => {
                  const chosen = [...selectedIds];
                  setMenuOpen(false);
                  setShowSubsetPicker(false);
                  void onOverride(
                    targetLocationId,
                    chosen.length === 0
                      ? { move_mode: "alone" }
                      : {
                          move_mode: "subset",
                          accompanying_character_ids: chosen,
                        }
                  );
                }}
              >
                {selectedIds.length === 0
                  ? "Move Alone (0 selected)"
                  : `Move Selected (${selectedIds.length})`}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
