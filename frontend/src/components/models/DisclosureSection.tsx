import React, { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface DisclosureSectionProps {
  title: string;
  /** Shown while collapsed so current values stay visible without expanding. */
  summary?: React.ReactNode;
  /** Number of invalid fields inside; shown as a badge so collapsed errors are never invisible. */
  invalidCount?: number;
  /** Auto-expand as soon as something inside becomes invalid. */
  forceOpenOnInvalid?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** Collapsible section whose children stay mounted when collapsed, so values and drafts persist. */
export const DisclosureSection: React.FC<DisclosureSectionProps> = ({
  title,
  summary,
  invalidCount = 0,
  forceOpenOnInvalid = true,
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (forceOpenOnInvalid && invalidCount > 0) setOpen(true);
  }, [forceOpenOnInvalid, invalidCount]);

  return (
    <div className="disclosure">
      <button
        type="button"
        className="disclosure-header"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="disclosure-title">{title}</span>
        {!open && summary && <span className="disclosure-summary">{summary}</span>}
        {invalidCount > 0 && (
          <span className="disclosure-invalid" role="status">
            {invalidCount} invalid
          </span>
        )}
      </button>
      <div className="disclosure-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
};
