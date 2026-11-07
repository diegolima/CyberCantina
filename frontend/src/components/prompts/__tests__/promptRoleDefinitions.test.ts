import { describe, expect, it } from "vitest";
import {
  PROMPT_ROLES,
  PromptRoleId,
  getRoleForPromptKey,
} from "../promptRoleDefinitions";

describe("promptRoleDefinitions", () => {
  const ALL_13_PROMPTS = [
    "actor_zone1_system",
    "narrator_zone1_system",
    "character_cognition_system",
    "character_post_turn_system",
    "clerk_pre_turn_system",
    "clerk_post_turn_system",
    "clerk_episodic_summary_system",
    "clerk_arbitration_system",
    "clerk_world_start_placement_system",
    "wizard_world_system",
    "wizard_character_system",
    "wizard_map_reimagine_system",
    "wizard_character_sillytavern_system",
  ];

  it("contains all 4 expected functional roles", () => {
    const roleIds: PromptRoleId[] = PROMPT_ROLES.map((r) => r.id);
    expect(roleIds).toEqual(["storytelling", "cognition", "auxiliary", "wizard"]);
  });

  it("maps every one of the 13 system prompt keys to exactly one role without duplicates", () => {
    const mappedKeys: string[] = [];
    for (const role of PROMPT_ROLES) {
      for (const key of role.promptKeys) {
        expect(ALL_13_PROMPTS).toContain(key);
        expect(mappedKeys).not.toContain(key);
        mappedKeys.push(key);
      }
    }

    expect(mappedKeys.length).toBe(13);
    for (const key of ALL_13_PROMPTS) {
      expect(mappedKeys).toContain(key);
    }
  });

  it("verifies expected partition sizes per role", () => {
    const storytelling = PROMPT_ROLES.find((r) => r.id === "storytelling")!;
    const cognition = PROMPT_ROLES.find((r) => r.id === "cognition")!;
    const auxiliary = PROMPT_ROLES.find((r) => r.id === "auxiliary")!;
    const wizard = PROMPT_ROLES.find((r) => r.id === "wizard")!;

    expect(storytelling.promptKeys).toHaveLength(2);
    expect(cognition.promptKeys).toHaveLength(2);
    expect(auxiliary.promptKeys).toHaveLength(5);
    expect(wizard.promptKeys).toHaveLength(4);
  });

  it("correctly resolves role via getRoleForPromptKey", () => {
    expect(getRoleForPromptKey("actor_zone1_system")).toBe("storytelling");
    expect(getRoleForPromptKey("narrator_zone1_system")).toBe("storytelling");

    expect(getRoleForPromptKey("character_cognition_system")).toBe("cognition");
    expect(getRoleForPromptKey("character_post_turn_system")).toBe("cognition");

    expect(getRoleForPromptKey("clerk_pre_turn_system")).toBe("auxiliary");
    expect(getRoleForPromptKey("clerk_world_start_placement_system")).toBe("auxiliary");

    expect(getRoleForPromptKey("wizard_world_system")).toBe("wizard");
    expect(getRoleForPromptKey("wizard_character_sillytavern_system")).toBe("wizard");

    // Unknown key fallback
    expect(getRoleForPromptKey("unknown_key_xyz")).toBe("auxiliary");
  });
});
