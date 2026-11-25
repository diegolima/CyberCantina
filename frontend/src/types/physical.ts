export type PhysicalStance =
  | "unspecified"
  | "standing"
  | "sitting"
  | "leaning"
  | "crouching"
  | "kneeling"
  | "lying_down"
  | "moving"
  | "restrained"
  | "incapacitated";

export type PhysicalStateResetReason = "location_changed" | "time_skip";

export type PhysicalStanceTone =
  | "muted"
  | "cyan"
  | "emerald"
  | "amber"
  | "violet"
  | "rose";

export interface PhysicalStanceOption {
  value: PhysicalStance;
  label: string;
  shortHint: string;
  tone: PhysicalStanceTone;
}

export const MAX_PHYSICAL_CONTEXT_LENGTH = 120;
export const STALE_TIME_SKIP_MINUTES = 30;

export const PHYSICAL_STANCE_OPTIONS: readonly PhysicalStanceOption[] = [
  {
    value: "unspecified",
    label: "Unspecified",
    shortHint: "No explicit stance established yet (omitted from prompts)",
    tone: "muted",
  },
  {
    value: "standing",
    label: "Standing",
    shortHint: "On feet in an upright position",
    tone: "emerald",
  },
  {
    value: "sitting",
    label: "Sitting",
    shortHint: "Seated on a chair, booth, floor, or ledge",
    tone: "cyan",
  },
  {
    value: "leaning",
    label: "Leaning",
    shortHint: "Propped or braced against a wall, bar, or railing",
    tone: "cyan",
  },
  {
    value: "crouching",
    label: "Crouching",
    shortHint: "Low crouched or hunkered posture behind cover",
    tone: "amber",
  },
  {
    value: "kneeling",
    label: "Kneeling",
    shortHint: "On one or both knees",
    tone: "amber",
  },
  {
    value: "lying_down",
    label: "Lying Down",
    shortHint: "Prone on stomach, supine on back, or sprawled flat",
    tone: "violet",
  },
  {
    value: "moving",
    label: "Moving",
    shortHint: "Walking, running, pacing, climbing, or crawling",
    tone: "cyan",
  },
  {
    value: "restrained",
    label: "Restrained",
    shortHint: "Bound, cuffed, grappled, or physically pinned",
    tone: "rose",
  },
  {
    value: "incapacitated",
    label: "Incapacitated",
    shortHint: "Unconscious, collapsed, stunned, or immobilized",
    tone: "rose",
  },
] as const;

export interface PhysicalStateOverridePayload {
  physical_stance: PhysicalStance;
  physical_context: string;
}

const STANCE_BY_VALUE: Readonly<Record<PhysicalStance, PhysicalStanceOption>> =
  Object.fromEntries(
    PHYSICAL_STANCE_OPTIONS.map((opt) => [opt.value, opt])
  ) as Record<PhysicalStance, PhysicalStanceOption>;

export function getPhysicalStanceMeta(
  stance?: PhysicalStance | null
): PhysicalStanceOption {
  if (stance && stance in STANCE_BY_VALUE) {
    return STANCE_BY_VALUE[stance];
  }
  return STANCE_BY_VALUE.unspecified;
}

export function formatPhysicalStanceLabel(
  stance?: PhysicalStance | null
): string {
  return getPhysicalStanceMeta(stance).label;
}

export function isPhysicalStateEstablished(
  stance?: PhysicalStance | null,
  context?: string | null
): boolean {
  return Boolean(
    (stance && stance !== "unspecified") || (context && context.trim().length > 0)
  );
}

export function formatPhysicalStateResetLabel(
  reason?: PhysicalStateResetReason | null
): string {
  if (reason === "location_changed") return "Reset on travel";
  if (reason === "time_skip") return "Reset on time skip";
  return "";
}
