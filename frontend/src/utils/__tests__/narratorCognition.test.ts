import { describe, expect, it } from "vitest";
import {
  isLiveStreamCognitionSkipped,
  isLiveStreamNarrator,
  isNarratorTurnNode,
  isTurnCognitionSkipped,
} from "../narratorCognition";
import type {
  CognitionBlock,
  PreTurnAnalysis,
  TurnNodeRecord,
} from "../../types";

describe("Narrator Cognition Helper Logic", () => {
  describe("isNarratorTurnNode", () => {
    it("identifies turn with actor_id='__narrator__' as narrator turn", () => {
      const turn = {
        actor_id: "__narrator__",
        user_message: "[Describe the current scene]",
      } as Pick<TurnNodeRecord, "actor_id" | "user_message">;
      expect(isNarratorTurnNode(turn)).toBe(true);
    });

    it("identifies turn with [NARRATOR DIRECTIVE] prefix as narrator turn", () => {
      const turn = {
        actor_id: "char_alice",
        user_message: "[NARRATOR DIRECTIVE] advance time by 10 minutes",
      } as Pick<TurnNodeRecord, "actor_id" | "user_message">;
      expect(isNarratorTurnNode(turn)).toBe(true);
    });

    it("returns false for standard character turn", () => {
      const turn = {
        actor_id: "char_alice",
        user_message: "Hello Alice!",
      } as Pick<TurnNodeRecord, "actor_id" | "user_message">;
      expect(isNarratorTurnNode(turn)).toBe(false);
    });
  });

  describe("isTurnCognitionSkipped", () => {
    it("does NOT trigger skipped warning for narrator turns even if cognition.skipped is true", () => {
      const narratorTurn = {
        actor_id: "__narrator__",
        user_message: "[Describe the current scene]",
      } as Pick<TurnNodeRecord, "actor_id" | "user_message">;

      const dummyNarratorCog: CognitionBlock = {
        recall: "Observing Sector 4",
        feeling: "Objective / Detached",
        valence: 0.0,
        arousal: 0.0,
        want: "Depict environment",
        plan: "Describe scene",
        skipped: true,
      };

      expect(isTurnCognitionSkipped(narratorTurn, dummyNarratorCog)).toBe(false);
    });

    it("triggers skipped warning for character turn when cognition.skipped is true", () => {
      const charTurn = {
        actor_id: "char_alice",
        user_message: "Can you fix the comms?",
      } as Pick<TurnNodeRecord, "actor_id" | "user_message">;

      const skippedCog: CognitionBlock = {
        recall: "",
        feeling: "Neutral",
        valence: 0.0,
        arousal: 0.0,
        want: "",
        plan: "",
        skipped: true,
      };

      expect(isTurnCognitionSkipped(charTurn, skippedCog)).toBe(true);
    });

    it("triggers skipped warning for character turn when recall is omitted", () => {
      const charTurn = {
        actor_id: "char_alice",
        user_message: "Can you fix the comms?",
      } as Pick<TurnNodeRecord, "actor_id" | "user_message">;

      const incompleteCog: CognitionBlock = {
        recall: "",
        feeling: "Focused",
        valence: 0.1,
        arousal: 0.2,
        want: "Help",
        plan: "Inspect wires",
        skipped: false,
      };

      expect(isTurnCognitionSkipped(charTurn, incompleteCog)).toBe(true);
    });

    it("does not trigger skipped warning for a normal character turn with valid cognition", () => {
      const charTurn = {
        actor_id: "char_alice",
        user_message: "Can you fix the comms?",
      } as Pick<TurnNodeRecord, "actor_id" | "user_message">;

      const validCog: CognitionBlock = {
        recall: "Remembering previous comm repair",
        feeling: "Confident",
        valence: 0.3,
        arousal: 0.2,
        want: "Repair device",
        plan: "Splice cables",
        skipped: false,
      };

      expect(isTurnCognitionSkipped(charTurn, validCog)).toBe(false);
    });
  });

  describe("Live Stream Narrator Detection", () => {
    it("detects narrator stream from isNarrator flag", () => {
      expect(isLiveStreamNarrator({ isNarrator: true })).toBe(true);
    });

    it("detects narrator stream from feeling='Objective / Detached'", () => {
      expect(
        isLiveStreamNarrator({
          cognitionParsed: {
            feeling: "Objective / Detached",
            valence: 0.0,
            arousal: 0.0,
            recall: "",
            want: "",
            plan: "",
          },
        })
      ).toBe(true);
    });

    it("detects narrator stream from preTurn active_speaker_id='__narrator__'", () => {
      expect(
        isLiveStreamNarrator({
          preTurn: {
            active_speaker_id: "__narrator__",
          } as PreTurnAnalysis,
        })
      ).toBe(true);
    });

    it("evaluates liveSkipped as false for narrator stream", () => {
      const live = { isNarrator: true };
      const skippedCog: CognitionBlock = {
        recall: "Observing room",
        feeling: "Objective / Detached",
        valence: 0,
        arousal: 0,
        want: "",
        plan: "",
        skipped: true,
      };

      expect(isLiveStreamCognitionSkipped(live, skippedCog)).toBe(false);
    });

    it("evaluates liveSkipped as true for standard character stream when skipped is true", () => {
      const live = { isNarrator: false };
      const skippedCog: CognitionBlock = {
        recall: "",
        feeling: "",
        valence: 0,
        arousal: 0,
        want: "",
        plan: "",
        skipped: true,
      };

      expect(isLiveStreamCognitionSkipped(live, skippedCog)).toBe(true);
    });
  });
});
