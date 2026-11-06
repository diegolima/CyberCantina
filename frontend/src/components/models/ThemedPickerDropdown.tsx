import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export interface ThemedPickerOption {
  id: string;
  label: string;
  secondaryLabel?: string;
  badge?: React.ReactNode;
  icon?: React.ReactNode;
  isCurrent?: boolean;
  disabled?: boolean;
}

export interface ThemedPickerGroup {
  groupLabel: string;
  items: ThemedPickerOption[];
}

export interface ThemedPickerDropdownProps {
  label?: string;
  currentLabel: string;
  currentTag?: string;
  currentIcon?: React.ReactNode;
  currentBadge?: React.ReactNode;
  groups?: ThemedPickerGroup[];
  options?: ThemedPickerOption[];
  onSelect: (id: string) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  disabled?: boolean;
  buttonVariant?: "hero" | "subtle" | "pill";
  emptyMessage?: string;
  warningNote?: React.ReactNode;
  titleTooltip?: string;
  onOpenChange?: (open: boolean) => void;
  align?: "left" | "right";
}

export const ThemedPickerDropdown: React.FC<ThemedPickerDropdownProps> = ({
  label,
  currentLabel,
  currentTag,
  currentIcon,
  currentBadge,
  groups,
  options,
  onSelect,
  searchable = false,
  searchPlaceholder = "Filter options...",
  disabled = false,
  buttonVariant = "subtle",
  emptyMessage = "No options available",
  warningNote,
  titleTooltip,
  onOpenChange,
  align = "left",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [isOpen]);

  // Focus search input on open
  useEffect(() => {
    if (isOpen && searchable) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isOpen, searchable]);

  // Filter options or grouped options
  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (groups && groups.length > 0) {
      return groups
        .map((g) => ({
          groupLabel: g.groupLabel,
          items: g.items.filter(
            (item) =>
              !q ||
              item.label.toLowerCase().includes(q) ||
              (item.secondaryLabel && item.secondaryLabel.toLowerCase().includes(q))
          ),
        }))
        .filter((g) => g.items.length > 0);
    }
    if (options && options.length > 0) {
      const filtered = options.filter(
        (item) =>
          !q ||
          item.label.toLowerCase().includes(q) ||
          (item.secondaryLabel && item.secondaryLabel.toLowerCase().includes(q))
      );
      return [{ groupLabel: "", items: filtered }];
    }
    return [];
  }, [groups, options, searchQuery]);

  const totalFilteredCount = filteredGroups.reduce((acc, g) => acc + g.items.length, 0);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    setIsOpen((prev) => !prev);
    setSearchQuery("");
  };

  const handleSelectOption = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(id);
    setIsOpen(false);
    setSearchQuery("");
  };

  return (
    <div
      className={`themed-picker-container ${buttonVariant}`}
      ref={containerRef}
      style={{ position: "relative" }}
    >
      {/* Trigger Button */}
      <button
        type="button"
        className={`themed-picker-trigger ${buttonVariant} ${isOpen ? "open" : ""} ${disabled ? "disabled" : ""}`}
        onClick={handleToggle}
        disabled={disabled}
        title={titleTooltip || currentLabel}
      >
        <div className="themed-picker-trigger-content">
          {currentIcon && <span className="themed-picker-icon">{currentIcon}</span>}
          <span className="themed-picker-label" title={currentLabel}>
            {currentLabel}
          </span>
          {currentTag && <span className="model-tag-pill">{currentTag}</span>}
          {currentBadge}
        </div>
        {!disabled && <ChevronDown size={14} className={`themed-picker-chevron ${isOpen ? "rotate" : ""}`} />}
      </button>

      {/* Dropdown Menu Popover */}
      {isOpen && (
        <div className={`themed-picker-popover align-${align}`} onClick={(e) => e.stopPropagation()}>
          {label && <div className="themed-picker-popover-title">{label}</div>}

          {searchable && (
            <div className="themed-picker-search-bar">
              <Search size={13} className="themed-picker-search-icon" />
              <input
                ref={searchInputRef}
                type="text"
                className="themed-picker-search-input"
                placeholder={searchPlaceholder}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="themed-picker-search-clear"
                  onClick={() => setSearchQuery("")}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {warningNote && <div className="themed-picker-warning">{warningNote}</div>}

          <div className="themed-picker-options-list">
            {totalFilteredCount === 0 ? (
              <div className="themed-picker-empty">{emptyMessage}</div>
            ) : (
              filteredGroups.map((group, gIdx) => (
                <div key={gIdx} className="themed-picker-group">
                  {group.groupLabel && (
                    <div className="themed-picker-group-label">{group.groupLabel}</div>
                  )}
                  {group.items.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`themed-picker-option ${opt.isCurrent ? "current" : ""} ${
                        opt.disabled ? "disabled" : ""
                      }`}
                      onClick={(e) => handleSelectOption(opt.id, e)}
                      disabled={opt.disabled}
                    >
                      <div className="themed-picker-option-left">
                        {opt.icon && <span className="themed-picker-option-icon">{opt.icon}</span>}
                        <div className="themed-picker-option-text">
                          <span className="themed-picker-option-name">{opt.label}</span>
                          {opt.secondaryLabel && (
                            <span className="themed-picker-option-sub">{opt.secondaryLabel}</span>
                          )}
                        </div>
                      </div>
                      {opt.badge && <span className="themed-picker-option-badge">{opt.badge}</span>}
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
