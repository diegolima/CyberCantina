import { describe, it, expect } from "vitest";
import {
  normalizeQuotes,
  parseWhisperContent,
  decomposeClientUserMessage,
} from "../mentions";
import { CharacterRecord } from "../../types";

const mockCharacters: CharacterRecord[] = [
  {
    id: "char_elena",
    name: "Elena",
    tagline: "Ace Pilot",
    physical_appearance: "Tall, sharp eyes",
    core_persona: "Veteran spacer",
    initial_message: "Ready to fly.",
    world_id: "world_1",
    version: 1,
    tags: [],
    creator: "system",
    creator_notes: "",
    portraits: {},
    gallery: [],
    inventory: [],
    baseline_psyche: {
      mood_label: "calm",
      valence: 0.2,
      arousal: 0.1,
      core_drive: "protect crew",
      core_fear: "failure",
      default_want: "keep flying",
      default_plan: "survive",
    },
    memory_shards: [],
    voice_anchors: [],
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "char_jax",
    name: "Jax",
    tagline: "Street Fixer",
    physical_appearance: "Leather jacket, cybernetic arm",
    core_persona: "Underworld informant",
    initial_message: "What do you need?",
    world_id: "world_1",
    version: 1,
    tags: [],
    creator: "system",
    creator_notes: "",
    portraits: {},
    gallery: [],
    inventory: [],
    baseline_psyche: {
      mood_label: "alert",
      valence: -0.1,
      arousal: 0.4,
      core_drive: "profit",
      core_fear: "entrapment",
      default_want: "stay ahead",
      default_plan: "survive",
    },
    memory_shards: [],
    voice_anchors: [],
    created_at: "2026-01-01T00:00:00Z",
  },
];

describe("mentions utility", () => {
  it("normalizes curly/smart double and single quotes to standard quotes", () => {
    const raw = `“Watch out!” ‘Listen closely’ «Beware»`;
    const normalized = normalizeQuotes(raw);
    expect(normalized).toBe(`"Watch out!" 'Listen closely' "Beware"`);
  });

  it("parses mixed dialogue and sensory whispers correctly", () => {
    const content = `"Look out!" You hear me shout as I sprint past. "Get down!"`;
    const { speech, sensory } = parseWhisperContent(content);
    expect(speech).toEqual(["Look out!", "Get down!"]);
    expect(sensory).toEqual(["You hear me shout as I sprint past."]);
  });

  it("handles whispers with sensory-only content", () => {
    const content = `You notice a strange hum coming from the vents.`;
    const { speech, sensory } = parseWhisperContent(content);
    expect(speech).toEqual([]);
    expect(sensory).toEqual(["You notice a strange hum coming from the vents."]);
  });

  it("handles whispers with speech-only content", () => {
    const content = `"Don't look now, but we are being followed."`;
    const { speech, sensory } = parseWhisperContent(content);
    expect(speech).toEqual(["Don't look now, but we are being followed."]);
    expect(sensory).toEqual([]);
  });

  it("decomposes user message into public text and scoped whispers", () => {
    const raw = `We carefully open the airlock doors.
@Elena: "Look out!" You hear me shout as I run.
@Jax: You smell burning copper in the wiring.`;

    // Elena is present in current room, Jax is remote (comms)
    const decomposed = decomposeClientUserMessage(raw, mockCharacters, ["char_elena"]);

    expect(decomposed.public_text).toBe("We carefully open the airlock doors.");
    expect(decomposed.whispers).toHaveLength(2);

    const elenaWhisper = decomposed.whispers_by_character_id["char_elena"];
    expect(elenaWhisper).toBeDefined();
    expect(elenaWhisper.target_scope).toBe("local");
    expect(elenaWhisper.speech_parts).toEqual(["Look out!"]);
    expect(elenaWhisper.sensory_parts).toEqual(["You hear me shout as I run."]);

    const jaxWhisper = decomposed.whispers_by_character_id["char_jax"];
    expect(jaxWhisper).toBeDefined();
    expect(jaxWhisper.target_scope).toBe("remote");
    expect(jaxWhisper.speech_parts).toEqual([]);
    expect(jaxWhisper.sensory_parts).toEqual(["You smell burning copper in the wiring."]);
  });

  it("strictly enforces that @Character Name: must be the first string in a line", () => {
    const raw = `We walk into the room and I whisper to @Elena: Don't shoot yet.`;
    const decomposed = decomposeClientUserMessage(raw, mockCharacters, ["char_elena"]);

    // Since @Elena: is NOT the first string in the line, it is treated as regular public dialogue/action
    expect(decomposed.public_text).toBe(`We walk into the room and I whisper to @Elena: Don't shoot yet.`);
    expect(decomposed.whispers).toHaveLength(0);
  });
});
