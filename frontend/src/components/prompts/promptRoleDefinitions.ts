import { BookOpen, Brain, Cpu, Sparkles, LucideIcon } from "lucide-react";

export type PromptRoleId = "storytelling" | "cognition" | "auxiliary" | "wizard";

export interface PromptRoleMeta {
  id: PromptRoleId;
  title: string;
  subtitle: string;
  description: string;
  accent: string;
  icon: LucideIcon;
  promptKeys: string[];
}

export const PROMPT_ROLES: PromptRoleMeta[] = [
  {
    id: "storytelling",
    title: "Storytelling",
    subtitle: "Phase 3 Narrative & Dialogue",
    description: "System prompts for in-character roleplay actors and neutral world narration.",
    accent: "var(--accent-amber)",
    icon: BookOpen,
    promptKeys: [
      "actor_zone1_system",
      "narrator_zone1_system",
    ],
  },
  {
    id: "cognition",
    title: "Cognition",
    subtitle: "Subconscious & Psychology",
    description: "Private character thoughts (recall, feeling, want, plan) and psychological state transitions.",
    accent: "var(--accent-purple, #a855f7)",
    icon: Brain,
    promptKeys: [
      "character_cognition_system",
      "character_post_turn_system",
    ],
  },
  {
    id: "auxiliary",
    title: "Auxiliary",
    subtitle: "Phase 1 & 4 Simulation Clerks",
    description: "Background Game Master clerk: intent parsing, dice mechanics, world clock, scene flags, and summaries.",
    accent: "var(--accent-cyan)",
    icon: Cpu,
    promptKeys: [
      "clerk_pre_turn_system",
      "clerk_post_turn_system",
      "clerk_episodic_summary_system",
      "clerk_arbitration_system",
      "clerk_world_start_placement_system",
    ],
  },
  {
    id: "wizard",
    title: "Wizard",
    subtitle: "World & Character Generators",
    description: "Offline generative tools for building worlds, topologies, character sheets, and card imports.",
    accent: "var(--accent-emerald)",
    icon: Sparkles,
    promptKeys: [
      "wizard_world_system",
      "wizard_character_system",
      "wizard_map_reimagine_system",
      "wizard_character_sillytavern_system",
    ],
  },
];

export function getRoleForPromptKey(key: string): PromptRoleId {
  for (const role of PROMPT_ROLES) {
    if (role.promptKeys.includes(key)) {
      return role.id;
    }
  }
  return "auxiliary";
}
