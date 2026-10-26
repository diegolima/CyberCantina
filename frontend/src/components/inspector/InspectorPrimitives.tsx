import React, { useCallback, useEffect, useId, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

const STORAGE_PREFIX = "cybercantina.inspector.";

/**
 * useState backed by localStorage so inspector open/closed state survives
 * reloads, re-renders and campaign switches.
 */
export function usePersistentState<T>(
  key: string,
  initial: T
): [T, (value: T | ((prev: T) => T)) => void] {
  const storageKey = STORAGE_PREFIX + key;
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Storage may be unavailable (private mode / quota); state still works in-memory.
    }
  }, [storageKey, value]);

  return [value, setValue];
}

/** Small pulsing dot signalling that a collapsed section changed this turn. */
export const ChangeDot: React.FC<{ title?: string }> = ({ title }) => (
  <span className="change-dot" title={title}>
    {title && <span className="sr-only">{title}</span>}
  </span>
);

interface InspectorSectionProps {
  /** Stable storage key for persisting the open state. */
  storageKey: string;
  title: React.ReactNode;
  icon?: React.ReactNode;
  /** Right-aligned summary shown in the header (e.g. counts). */
  meta?: React.ReactNode;
  /** Show a change indicator while collapsed. */
  changed?: boolean;
  changedTitle?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

/** Collapsible inspector card with an accessible header button. */
export const InspectorSection: React.FC<InspectorSectionProps> = ({
  storageKey,
  title,
  icon,
  meta,
  changed,
  changedTitle = "Updated this turn",
  defaultOpen = false,
  children,
}) => {
  const [open, setOpen] = usePersistentState<boolean>(
    `section.${storageKey}`,
    defaultOpen
  );
  const bodyId = useId();
  const toggle = useCallback(() => setOpen((o) => !o), [setOpen]);

  return (
    <div className="inspector-card inspector-collapsible">
      <button
        type="button"
        className="inspector-section-header"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={toggle}
      >
        <span className="inspector-section-title">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {icon}
          {title}
          {changed && !open && <ChangeDot title={changedTitle} />}
        </span>
        {meta !== undefined && meta !== null && (
          <span className="inspector-section-meta">{meta}</span>
        )}
      </button>
      {open && (
        <div id={bodyId} className="inspector-section-body">
          {children}
        </div>
      )}
    </div>
  );
};

/** Compact diverging valence bar + arousal bar for collapsed character rows. */
export const MiniMoodBars: React.FC<{ valence: number; arousal: number }> = ({
  valence,
  arousal,
}) => {
  const v = Math.max(-1, Math.min(1, valence));
  const a = Math.max(0, Math.min(1, arousal));
  const vWidth = Math.abs(v) * 50;
  const vLeft = v >= 0 ? 50 : 50 - vWidth;
  const label = `Valence ${v >= 0 ? "+" : ""}${v.toFixed(2)} · Arousal ${a.toFixed(2)}`;

  return (
    <span className="mini-mood" title={label} aria-label={label}>
      <span className="mini-mood-track mini-mood-diverging">
        <span
          className="mini-mood-fill"
          style={{
            left: `${vLeft}%`,
            width: `${vWidth}%`,
            background: v >= 0 ? "var(--accent-emerald)" : "var(--accent-rose)",
          }}
        />
      </span>
      <span className="mini-mood-track">
        <span
          className="mini-mood-fill"
          style={{ left: 0, width: `${a * 100}%`, background: "var(--accent-amber)" }}
        />
      </span>
    </span>
  );
};
