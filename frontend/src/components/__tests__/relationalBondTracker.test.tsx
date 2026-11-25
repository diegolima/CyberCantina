import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  AffectiveCareState,
  CharacterRecord,
  CharacterStateSnapshot,
  RelationalEdge,
  TurnNodeRecord,
} from "../../types";
import { CampaignCharacterStateTab } from "../world/codexCharacter/CampaignCharacterStateTab";
import { RelationalBondChart } from "../world/codexCharacter/RelationalBondChart";
import {
  RELATIONAL_METRICS,
  type RelationalHistoryPoint,
  computeSparseTickIndices,
  extractBondHistorySeries,
  formatMetricValue,
  mapValueToChartY,
  sliceBondHistoryWindow,
} from "../world/codexCharacter/relationalHistory";

function makeEdge(
  targetId: string,
  overrides: Partial<RelationalEdge> = {}
): RelationalEdge {
  return {
    target_id: targetId,
    warmth: 0.2,
    respect: 0.3,
    trust: 0.1,
    power: 0.0,
    grievance: 0.0,
    obligation: 0.0,
    consolidated_warmth: 0.2,
    consolidated_trust: 0.1,
    episodic_note: "",
    ...overrides,
  };
}

function makeCareState(
  relations: Record<string, RelationalEdge>
): AffectiveCareState {
  return {
    schema_version: 1,
    is_provisional: false,
    state_elapsed_minutes: 10,
    valence: 0.2,
    arousal: 0.4,
    dominance: 0.1,
    composure: 0.85,
    mood_variance: [0.05, 0.05, 0.05],
    active_emotion: "default",
    short_mood_label: "Steady",
    outward_demeanor: "Measured watch",
    active_worldview: { benevolence: 0.1, belonging: 0.2, agency: 0.3 },
    appraisal: { threat: 0.1, coping: 0.4, goal_congruence: 0.3, ambiguity: 0.1 },
    relations,
  };
}

function makeSnapshot(
  turnId: string,
  charId: string,
  relations: Record<string, RelationalEdge>
): CharacterStateSnapshot {
  return {
    turn_id: turnId,
    character_id: charId,
    current_location_id: "loc_1",
    mood_label: "Steady",
    valence: 0.2,
    arousal: 0.4,
    active_want: "Hold the pier",
    active_plan: "Watch signals",
    relationship_notes: {},
    inventory: [],
    care_state: makeCareState(relations),
  };
}

function makeTurn(opts: {
  id: string;
  depthIndex: number;
  actorId?: string;
  primaryCharId?: string;
  primaryRelations?: Record<string, RelationalEdge>;
  extraStates?: Record<string, CharacterStateSnapshot>;
}): TurnNodeRecord {
  const primaryId = opts.primaryCharId ?? "char_a";
  const primarySnap = makeSnapshot(opts.id, primaryId, opts.primaryRelations ?? {});
  return {
    id: opts.id,
    campaign_id: "camp_1",
    parent_turn_id: opts.depthIndex === 0 ? null : `t_${opts.depthIndex - 1}`,
    depth_index: opts.depthIndex,
    user_message: opts.actorId === "__arrival__" ? "[Moved]" : `Turn ${opts.depthIndex}`,
    actor_id: opts.actorId ?? primaryId,
    raw_prose: "Prose",
    cognition: {
      recall: "",
      feeling: "Steady",
      valence: 0.2,
      arousal: 0.4,
      want: "Hold",
      plan: "Watch",
    },
    pre_turn: {
      user_sentiment: "calm",
      subtext_interpretation: "",
      mentioned_entities: [],
      memory_search_queries: [],
      spatial_intent: "stay",
      mechanics_check: {
        requires_roll: false,
        action_description: "",
        skill_or_approach: "",
        difficulty_class: 10,
        relevant_modifier: 0,
      },
    },
    recalled_items: [],
    world_snapshot: {
      turn_id: opts.id,
      active_location_id: "loc_1",
      visited_location_ids: ["loc_1"],
      visited_container_ids: [],
      scene_flags: [],
      world_timestamp: "Day 1",
    },
    character_state: primarySnap,
    character_states: {
      [primaryId]: primarySnap,
      ...(opts.extraStates ?? {}),
    },
    created_at: "2026-01-01T00:00:00Z",
  };
}

const CHAR_ARIA: CharacterRecord = {
  id: "char_a",
  version: 1,
  name: "Aria Kell",
  tagline: "Signal watcher",
  character_bio: "Keeps the outer beacons.",
  core_persona: "Calm under fog.",
  communication_style: ["terse"],
  initial_message: "Keep watch.",
  equipped: [],
  inventory: [],
  voice_anchors: [],
  baseline_psyche: {
    mood_label: "Steady",
    valence: 0.1,
    arousal: 0.3,
    core_drive: "CORE_DRIVE_ONLY_IN_PERSONALITY",
    core_fear: "CORE_FEAR_ONLY_IN_PERSONALITY",
    default_want: "DEFAULT_WANT_SEED",
    default_plan: "DEFAULT_PLAN_SEED",
  },
  memory_shards: [],
  tags: [],
  creator: "tester",
  creator_notes: "",
  portraits: {},
  gallery: [],
  created_at: "2026-01-01T00:00:00Z",
};

describe("Dyadic Relational Bond History & Chart (v0.39.1)", () => {
  it("extracts per-turn series, excludes __arrival__ waypoints, and starts late-joining bonds at their first turn", () => {
    const turns: TurnNodeRecord[] = [
      makeTurn({
        id: "t_0",
        depthIndex: 0,
        primaryRelations: {
          user: makeEdge("user", { warmth: 0.1, trust: 0.0, episodic_note: "First meeting." }),
        },
      }),
      makeTurn({
        id: "t_move",
        depthIndex: 1,
        actorId: "__arrival__",
        primaryRelations: {
          user: makeEdge("user", { warmth: 0.1, trust: 0.0, episodic_note: "Should be skipped" }),
        },
      }),
      makeTurn({
        id: "t_2",
        depthIndex: 2,
        primaryRelations: {
          user: makeEdge("user", { warmth: 0.35, trust: 0.25, episodic_note: "Shared watch." }),
          char_b: makeEdge("char_b", { warmth: -0.2, trust: -0.1, episodic_note: "Rivalry begins." }),
        },
        extraStates: {
          char_b: makeSnapshot("t_2", "char_b", {
            user: makeEdge("user", { warmth: 0.5, trust: 0.4, episodic_note: "Secondary NPC bond" }),
          }),
        },
      }),
    ];

    const userSeries = extractBondHistorySeries({
      characterId: "char_a",
      targetId: "user",
      activeBranchTurns: turns,
    });
    expect(userSeries.map((p) => p.depthIndex)).toEqual([0, 2]);
    expect(userSeries.map((p) => p.warmth)).toEqual([0.1, 0.35]);
    expect(userSeries[1].episodicNote).toBe("Shared watch.");

    // Late-joining bond with char_b starts at Turn #2 (no synthetic Turn #0 zeros)
    const lateSeries = extractBondHistorySeries({
      characterId: "char_a",
      targetId: "char_b",
      activeBranchTurns: turns,
    });
    expect(lateSeries).toHaveLength(1);
    expect(lateSeries[0].depthIndex).toBe(2);
    expect(lateSeries[0].episodicNote).toBe("Rivalry begins.");

    // Secondary participant lookup from character_states
    const secondarySeries = extractBondHistorySeries({
      characterId: "char_b",
      targetId: "user",
      activeBranchTurns: turns,
    });
    expect(secondarySeries).toHaveLength(1);
    expect(secondarySeries[0].warmth).toBe(0.5);

    // Fallback when live state is absent from activeBranchTurns
    const fallbackSeries = extractBondHistorySeries({
      characterId: "char_a",
      targetId: "user",
      activeBranchTurns: [],
      currentState: makeSnapshot("t_live", "char_a", {
        user: makeEdge("user", { warmth: 0.6, episodic_note: "Live only" }),
      }),
    });
    expect(fallbackSeries).toHaveLength(1);
    expect(fallbackSeries[0].warmth).toBe(0.6);
  });

  it("handles window slicing, sparse tick computation, Y mapping, and formatting", () => {
    const manyPoints: RelationalHistoryPoint[] = Array.from({ length: 30 }, (_, i) => ({
      turnId: `t_${i}`,
      depthIndex: i,
      warmth: 0.1,
      trust: 0.2,
      respect: 0.3,
      power: 0,
      grievance: 0,
      obligation: 0,
      episodicNote: "",
    }));
    expect(sliceBondHistoryWindow(manyPoints, "all")).toHaveLength(30);
    const last25 = sliceBondHistoryWindow(manyPoints, "last25");
    expect(last25).toHaveLength(25);
    expect(last25[0].depthIndex).toBe(5);
    expect(last25[24].depthIndex).toBe(29);

    expect(computeSparseTickIndices(1)).toEqual([0]);
    expect(computeSparseTickIndices(4)).toEqual([0, 1, 2, 3]);
    const sparse = computeSparseTickIndices(30, 6);
    expect(sparse[0]).toBe(0);
    expect(sparse[sparse.length - 1]).toBe(29);
    expect(sparse.length).toBeLessThanOrEqual(6);

    expect(mapValueToChartY(1, 10, 100)).toBe(10);
    expect(mapValueToChartY(0, 10, 100)).toBe(60);
    expect(mapValueToChartY(-1, 10, 100)).toBe(110);

    const warmthMeta = RELATIONAL_METRICS.find((m) => m.key === "warmth")!;
    const grievanceMeta = RELATIONAL_METRICS.find((m) => m.key === "grievance")!;
    expect(formatMetricValue(warmthMeta, 0.45)).toBe("+0.45");
    expect(formatMetricValue(warmthMeta, -0.3)).toBe("-0.30");
    expect(formatMetricValue(grievanceMeta, 0.42)).toBe("42%");
  });

  it("renders RelationalBondChart SVG polylines, single-turn caption, Last 25 toggle, and grievance % readout", () => {
    const singleHtml = renderToStaticMarkup(
      <RelationalBondChart
        targetLabel="Player (You)"
        points={[
          {
            turnId: "t_0",
            depthIndex: 0,
            warmth: 0.2,
            trust: 0.1,
            respect: 0.3,
            power: 0.0,
            grievance: 0.0,
            obligation: 0.0,
            episodicNote: "Opening watch.",
          },
        ]}
      />
    );
    expect(singleHtml).toContain("1 turn recorded");
    expect(singleHtml).toContain("Opening watch.");
    expect(singleHtml).toContain("Turn #0");
    expect(singleHtml).not.toContain("<polyline");
    expect(singleHtml).not.toContain("Last 25");

    const thirtyPoints: RelationalHistoryPoint[] = Array.from({ length: 30 }, (_, i) => ({
      turnId: `t_${i}`,
      depthIndex: i,
      warmth: -0.2 + i * 0.02,
      trust: 0.1 + i * 0.01,
      respect: 0.3,
      power: 0.05,
      grievance: 0.35,
      obligation: 0.15,
      episodicNote: i === 29 ? "Latest breakthrough." : "",
    }));
    const multiHtml = renderToStaticMarkup(
      <RelationalBondChart
        targetLabel="Player (You)"
        points={thirtyPoints}
        initialEnabledMetrics={["warmth", "trust", "grievance"]}
      />
    );
    expect(multiHtml).toContain("<polyline");
    expect(multiHtml).toContain("All (30)");
    expect(multiHtml).toContain("Last 25");
    expect(multiHtml).toContain("Turn #29");
    expect(multiHtml).toContain("Latest breakthrough.");
    expect(multiHtml).toContain("35%");
    expect(multiHtml).not.toContain("<foreignObject");
  });

  it("renders expandable bond cards without Core Drive/Fear in CampaignCharacterStateTab", () => {
    const t0 = makeTurn({
      id: "t_0",
      depthIndex: 0,
      primaryRelations: {
        user: makeEdge("user", { warmth: 0.1, episodic_note: "Cool start." }),
      },
    });
    const t1 = makeTurn({
      id: "t_1",
      depthIndex: 1,
      primaryRelations: {
        user: makeEdge("user", { warmth: 0.45, episodic_note: "Shared lantern duty." }),
      },
    });

    const html = renderToStaticMarkup(
      <CampaignCharacterStateTab
        character={CHAR_ARIA}
        state={t1.character_state}
        isPresent={true}
        characterNameMap={{ [CHAR_ARIA.id]: CHAR_ARIA.name }}
        activeBranchTurns={[t0, t1]}
        initialExpandedBondTargets={["user"]}
        isActive={true}
      />
    );
    expect(html).not.toContain("CORE_DRIVE_ONLY_IN_PERSONALITY");
    expect(html).not.toContain("CORE_FEAR_ONLY_IN_PERSONALITY");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Relational history with Player (You)");
    expect(html).toContain("<polyline");
    expect(html).toContain("Shared lantern duty.");
  });
});
