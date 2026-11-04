import { Notch, SliderSpec } from "./sliderMath";

/**
 * Bounds mirror the backend ModelProfile constraints (temperature 0..2, max_tokens 64..8192).
 * backend/tests/test_providers_and_byop.py::test_ui_limits_match_backend_bounds keeps them in sync.
 */
export const TEMPERATURE_HARD_MIN = 0;
export const TEMPERATURE_HARD_MAX = 2;
export const MAX_TOKENS_HARD_MIN = 64;
export const MAX_TOKENS_HARD_MAX = 8192;

export type ModelRole = "actor" | "clerk";

const TEMPERATURE_NOTCHES: Notch[] = [
  { value: 0.2, label: "Analytical" },
  { value: 0.7, label: "Balanced" },
  { value: 1.0, label: "Creative" },
  { value: 1.4, label: "Wild" },
];

/** Prose scale for the Actor (cognition + narrative). */
const ACTOR_TOKEN_NOTCHES: Notch[] = [
  { value: 512, label: "Brisk" },
  { value: 1024, label: "Standard" },
  { value: 2048, label: "Novelistic" },
  { value: 4096, label: "Extended" },
];

/** The Clerk emits strict JSON, so its scale is lower; 768 is its default and sits on a notch. */
const CLERK_TOKEN_NOTCHES: Notch[] = [
  { value: 256, label: "Tiny" },
  { value: 512, label: "Short" },
  { value: 768, label: "Default" },
  { value: 1024, label: "Long" },
  { value: 2048, label: "Max" },
];

export const TEMPERATURE_SPEC: SliderSpec = {
  hardMin: TEMPERATURE_HARD_MIN,
  hardMax: TEMPERATURE_HARD_MAX,
  trackMin: 0,
  trackMax: 2,
  step: 0.05,
  precision: 2,
  scale: "linear",
  notches: TEMPERATURE_NOTCHES,
};

export function maxTokensSpec(role: ModelRole): SliderSpec {
  const notches = role === "actor" ? ACTOR_TOKEN_NOTCHES : CLERK_TOKEN_NOTCHES;
  return {
    hardMin: MAX_TOKENS_HARD_MIN,
    hardMax: MAX_TOKENS_HARD_MAX,
    trackMin: notches[0].value,
    trackMax: notches[notches.length - 1].value,
    step: 32,
    precision: 0,
    scale: "log",
    notches,
  };
}
