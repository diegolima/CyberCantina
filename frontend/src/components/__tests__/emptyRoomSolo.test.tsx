import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  CampaignStateBundle,
  CharacterRecord,
  LocationNode,
  TurnNodeRecord,
  UseMagicWandReturn,
  WorldRecord,
} from "../../types";
import { ChatStage } from "../ChatStage";
import { LiveInspector } from "../LiveInspector";
import { ChatComposer } from "../chat/ChatComposer";
import { DirectorChoicesDrawer } from "../chat/DirectorChoicesDrawer";
import { LiveStreamingTurnCard } from "../chat/LiveStreamingTurnCard";
import { TurnCard } from "../chat/TurnCard";
import { buildCampaignCharacterEntries } from "../world/codexHelpers";

function makeSoloFixture() {
  const originLoc: LocationNode = {
    id: "loc_origin",
    world_id: "world_1",
    is_entry_exit: true,
    name: "Main Floor",
    summary: "Ground floor lounge.",
    description: "Neon tubes hum over steel booths.",
    environmental_tags: [],
    is_starting_location: true,
  };
  const emptyLoc: LocationNode = {
    id: "loc_empty",
    world_id: "world_1",
    is_entry_exit: false,
    name: "Abandoned Annex",
    summary: "Dark storage wing.",
    description: "Dust swirls across sealed crates.",
    environmental_tags: [],
    is_starting_location: false,
  };

  const absentChar: CharacterRecord = {
    id: "char_vesper",
    name: "Vesper Operative",
    tagline: "Watchful sentinel",
    physical_appearance: "Charcoal jacket.",
    core_persona: "Measured operative.",
    initial_message: "Waiting here.",
    character_bio: "Operative.",
    voice_anchors: [],
    personality_traits: [],
    moral_code: [],
    quirks_flaws: [],
    communication_style: [],
    equipped: [],
    inventory: [],
    baseline_psyche: {
      mood_label: "Alert",
      valence: 0,
      arousal: 0.4,
      core_drive: "Stay alert",
      core_fear: "Ambush",
      default_want: "Hold position",
      default_plan: "Watch the entrance",
    },
    memory_shards: [],
    version: 1,
    tags: [],
    creator: "test",
    creator_notes: "",
    portraits: {
      default: "/api/characters/char_vesper/media/portraits/default.png",
    },
    gallery: [],
    created_at: "2026-01-01T00:00:00Z",
  };

  const soloTurn: TurnNodeRecord = {
    id: "turn_solo_1",
    campaign_id: "camp_1",
    parent_turn_id: "turn_0",
    depth_index: 1,
    user_message: "I pry open the bolted locker inside the annex.",
    actor_id: "__solo__",
    raw_prose: "*The rusted clasp snaps free, revealing an empty copper conduit.*",
    cognition: {
      recall: "Observing Abandoned Annex",
      feeling: "Objective / Detached",
      valence: 0,
      arousal: 0,
      want: "Depict environment",
      plan: "Describe scene",
      skipped: true,
    },
    cognitions: {},
    pre_turn: {
      user_sentiment: "determined",
      subtext_interpretation: "Searching alone",
      mentioned_entities: ["locker"],
      memory_search_queries: ["annex locker"],
      spatial_intent: "stay",
      active_speaker_id: "__solo__",
      speaker_order: [],
      dice_mode: "forced",
      manual_dice_value: 16,
      mechanics_check: {
        requires_roll: true,
        action_description: "Prying open the locker",
        skill_or_approach: "Athletics",
        difficulty_class: 12,
        relevant_modifier: 1,
      },
      character_rolls: {},
      resolved_roll: {
        character_id: "__solo__",
        character_name: "Alex Mercer",
        d20_raw: 16,
        modifier: 1,
        total: 17,
        difficulty_class: 12,
        outcome_tier: "Clean Success",
        action_description: "Prying open the locker",
        skill_or_approach: "Athletics",
        is_manual_override: true,
        narrative_directive: "Clean success without complications.",
      },
    },
    world_snapshot: {
      turn_id: "turn_solo_1",
      world_timestamp: "2094-11-14 23:20",
      active_location_id: emptyLoc.id,
      scene_flags: [],
      visited_location_ids: [originLoc.id, emptyLoc.id],
      visited_container_ids: [],
    },
    character_state: {
      turn_id: "turn_solo_1",
      character_id: absentChar.id,
      current_location_id: originLoc.id,
      mood_label: "Alert",
      valence: 0,
      arousal: 0.4,
      active_want: "Hold position",
      active_plan: "Watch the entrance",
      relationship_notes: {},
      equipped: [],
      inventory: [],
    },
    recalled_items: [],
    created_at: "2026-01-01T00:05:00Z",
  };

  const bundle: CampaignStateBundle = {
    campaign: {
      id: "camp_1",
      name: "Solo Run",
      world_id: "world_1",
      character_id: absentChar.id,
      participant_character_ids: [absentChar.id],
      active_leaf_turn_id: soloTurn.id,
      world_settings: { describe_on_first_visit: true },
      created_at: "2026-01-01T00:00:00Z",
    },
    active_branch_turns: [soloTurn],
    all_turn_nodes: [soloTurn],
    current_world_snapshot: soloTurn.world_snapshot,
    current_character_state: soloTurn.character_state,
    character_states: { [absentChar.id]: soloTurn.character_state },
    character_records: { [absentChar.id]: absentChar },
    present_character_ids: [],
    containers: [],
    active_location: emptyLoc,
    neighbor_locations: [],
    visible_locations: [originLoc, emptyLoc],
    visible_edges: [],
    episodic_chunks: [],
  };

  const world: WorldRecord = {
    id: "world_1",
    name: "Sector Test",
    global_rules: {
      genre: "Sci-Fi Noir",
      tone: "Gritty",
      setting_overview: "Industrial sector.",
      tech_or_magic_rules: "Cyberware.",
      starting_timestamp: "2094-11-14 23:15",
      describe_on_first_visit: true,
    },
    created_at: "2026-01-01T00:00:00Z",
    containers: [],
    locations: [originLoc, emptyLoc],
    edges: [],
    lore_nodes: [],
  };

  return { originLoc, emptyLoc, world, absentChar, soloTurn, bundle };
}

describe("Phase 1 Empty / Solo Room UI Components", () => {
  it("TurnCard renders Solo Scene badge and protagonist roll while omitting cognition box and absent character portrait", () => {
    const { absentChar, soloTurn, bundle } = makeSoloFixture();
    const html = renderToStaticMarkup(
      <TurnCard
        turn={soloTurn}
        turnIdx={1}
        bundle={bundle}
        character={absentChar}
        allCampaignCharacters={[absentChar]}
        presentCharacterIds={[]}
        siblings={[soloTurn]}
        isBusy={false}
        isDeletingTurn={false}
        isEditingThisTurn={false}
        hasActiveEditingTurn={false}
        hasDeleteLastHandler={false}
        cogOpen={true}
        memOpen={false}
        phase4ProgressByTurn={{}}
        onToggleCognition={() => {}}
        onToggleMemories={() => {}}
        onCheckoutTurn={() => {}}
        onStartEdit={() => {}}
        onCancelEdit={() => {}}
        onSwipeRegenerate={() => {}}
        onDeleteLast={() => {}}
        onOpenAgentModal={() => {}}
      />
    );

    expect(html).toContain("Solo Scene");
    expect(html).toContain("Alex Mercer: Athletics");
    expect(html).not.toContain("Skipped by Model");
    expect(html).not.toContain("Inner Cognition");
    expect(html).not.toContain("Objective Scene Observation");
    expect(html).not.toContain(absentChar.name);
    expect(html).not.toContain("portraits/default.png");
  });

  it("LiveStreamingTurnCard omits cognition box and renders Solo Scene & protagonist roll badges during solo stream", () => {
    const { absentChar, bundle, soloTurn } = makeSoloFixture();
    const html = renderToStaticMarkup(
      <LiveStreamingTurnCard
        liveStream={{
          userMessage: "I check behind the sealed crate.",
          preTurn: soloTurn.pre_turn,
          recalledItems: [],
          cognitionRaw: "",
          cognitionParsed: {
            recall: "Observing Abandoned Annex",
            feeling: "Objective / Detached",
            valence: 0,
            arousal: 0,
            want: "",
            plan: "",
            skipped: true,
          },
          proseText: "*Empty dust shifts across the concrete.*",
          phaseStatus: "Phase 4: Streaming Narrative Prose...",
          isNarrator: false,
          isSolo: true,
        }}
        bundle={bundle}
        character={absentChar}
        allCampaignCharacters={[absentChar]}
        presentCharacterIds={[]}
        phase3Progress={null}
      />
    );

    expect(html).toContain("Solo Scene");
    expect(html).toContain("Alex Mercer: Rolled 17 vs DC 12 [Clean Success]");
    expect(html).not.toContain("Skipped by Model");
    expect(html).not.toContain("Streaming &lt;cognition&gt;");
    expect(html).not.toContain("Objective Scene Observation");
  });

  it("ChatStage shows 'Abandoned Annex · Alone' subline when inspector is closed and stays single-row when docked open without attributing scene to absent character", () => {
    const { absentChar, bundle } = makeSoloFixture();
    const collapsedHtml = renderToStaticMarkup(
      <ChatStage
        bundle={bundle}
        character={absentChar}
        isStreaming={false}
        liveStream={null}
        onSendTurn={() => {}}
        onCheckoutTurn={() => {}}
        isInspectorOpen={false}
      />
    );

    expect(collapsedHtml).toContain("stage-context-subline");
    expect(collapsedHtml).toContain("Abandoned Annex");
    expect(collapsedHtml).toContain("Alone");
    expect(collapsedHtml).toContain("is-alone");
    expect(collapsedHtml).not.toContain("Actor:");

    const dockedHtml = renderToStaticMarkup(
      <ChatStage
        bundle={bundle}
        character={absentChar}
        isStreaming={false}
        liveStream={null}
        onSendTurn={() => {}}
        onCheckoutTurn={() => {}}
        isInspectorOpen={true}
      />
    );

    expect(dockedHtml).not.toContain("stage-context-subline");
    expect(dockedHtml).not.toContain("Actor:");
  });

  it("ChatComposer and DirectorChoicesDrawer disable Choices and render solo guidance in empty rooms", () => {
    const { absentChar, emptyLoc } = makeSoloFixture();
    const dummyWand: UseMagicWandReturn = {
      status: "idle",
      error: null,
      canEnrich: false,
      canRevert: false,
      isDirtyAfterApply: false,
      triggerEnrich: async () => {},
      cancelEnrich: () => {},
      revert: () => {},
      dismissUndo: () => {},
      reset: () => {},
    };

    const composerHtml = renderToStaticMarkup(
      <ChatComposer
        composerBarRef={React.createRef<HTMLFormElement>()}
        narratorBtnRef={React.createRef<HTMLButtonElement>()}
        exitsBtnRef={React.createRef<HTMLButtonElement>()}
        textareaRef={React.createRef<HTMLTextAreaElement>()}
        character={absentChar}
        editingTurn={null}
        activeTray="none"
        setActiveTray={() => {}}
        activePopover="none"
        setActivePopover={() => {}}
        customDirectiveText=""
        setCustomDirectiveText={() => {}}
        presentCharacters={[]}
        allCampaignCharacters={[absentChar]}
        presentCharacterIds={[]}
        stagedChoices={{}}
        activeChoiceCharId=""
        setActiveChoiceCharId={() => {}}
        activeCharRecord={undefined}
        totalStagedOptionsCount={0}
        diceMode="auto"
        setDiceMode={() => {}}
        diceOverride=""
        setDiceOverride={() => {}}
        hasActiveGates={false}
        choicePreview={null}
        choiceSlashWarning={null}
        decomposedInput={{
          raw_message: "",
          public_text: "",
          whispers: [],
          whispers_by_character_id: {},
          remote_whispers: [],
        }}
        mentionPickerOpen={false}
        setMentionPickerOpen={() => {}}
        mentionQuery=""
        mentionSelectedIndex={0}
        setMentionSelectedIndex={() => {}}
        filteredMentionCharacters={[absentChar]}
        inputText=""
        setInputText={() => {}}
        isBusy={false}
        magicWand={dummyWand}
        activeLocationName={emptyLoc.name}
        neighborLocations={[]}
        handleSelectMention={() => {}}
        handleRemoveMentionChip={() => {}}
        checkAndTriggerMention={() => {}}
        handleInvokeNarrator={() => {}}
        handleQuickExit={() => {}}
        handleSendCustomDirective={() => {}}
        handleClearAllChoices={() => {}}
        handleClearCharChoices={() => {}}
        handleSetDC={() => {}}
        handleAddOption={() => {}}
        handleUpdateOption={() => {}}
        handleRemoveOption={() => {}}
        handleCancelEdit={() => {}}
        handleSend={() => {}}
      />
    );

    expect(composerHtml).toContain(`You are alone in ${emptyLoc.name}`);
    expect(composerHtml).toContain("No characters present in this location to guide");
    expect(composerHtml).toMatch(/disabled=""[^>]*title="No characters present in this location to guide"|title="No characters present in this location to guide"[^>]*disabled=""/);

    const drawerHtml = renderToStaticMarkup(
      <DirectorChoicesDrawer
        presentCharacters={[]}
        stagedChoices={{}}
        activeChoiceCharId=""
        setActiveChoiceCharId={() => {}}
        activeCharRecord={undefined}
        totalStagedOptionsCount={0}
        diceMode="auto"
        choicePreview={null}
        onClearAll={() => {}}
        onClearChar={() => {}}
        onSetDC={() => {}}
        onAddOption={() => {}}
        onUpdateOption={() => {}}
        onRemoveOption={() => {}}
        onClose={() => {}}
      />
    );

    expect(drawerHtml).toContain("No characters present in this location to guide.");
  });

  it("buildCampaignCharacterEntries and LiveInspector mark absent primary character as Elsewhere when room is empty", () => {
    const { world, absentChar, bundle } = makeSoloFixture();

    const entriesExplicitEmpty = buildCampaignCharacterEntries(
      bundle,
      absentChar,
      [absentChar]
    );
    expect(entriesExplicitEmpty).toHaveLength(1);
    expect(entriesExplicitEmpty[0].isPresent).toBe(false);
    expect(entriesExplicitEmpty[0].elsewhereLocationName).toBe("Main Floor");

    const entriesUndefinedFallback = buildCampaignCharacterEntries(
      { ...bundle, present_character_ids: undefined },
      absentChar,
      [absentChar]
    );
    expect(entriesUndefinedFallback).toHaveLength(1);
    expect(entriesUndefinedFallback[0].isPresent).toBe(false);
    expect(entriesUndefinedFallback[0].elsewhereLocationName).toBe("Main Floor");

    const inspectorHtml = renderToStaticMarkup(
      <LiveInspector
        bundle={bundle}
        world={world}
        character={absentChar}
        participants={[absentChar]}
      />
    );
    expect(inspectorHtml).toContain("Here");
    expect(inspectorHtml).toContain("No other characters here");
    expect(inspectorHtml).toContain("Elsewhere");
    expect(inspectorHtml).not.toContain("char-row-absent");

    const expandedElsewhereHtml = renderToStaticMarkup(
      <LiveInspector
        bundle={bundle}
        world={world}
        character={absentChar}
        participants={[absentChar]}
        defaultElsewhereOpen={true}
      />
    );
    expect(expandedElsewhereHtml).toContain("char-row-absent");
    expect(expandedElsewhereHtml).toContain("Elsewhere");
    expect(expandedElsewhereHtml).toContain("Main Floor");
  });
});
