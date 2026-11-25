import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  TEMPERAMENT_ARCHETYPE_OPTIONS,
  type CampaignStateBundle,
  type CharacterRecord,
  type CharacterStateSnapshot,
  type LocationEdge,
  type LocationNode,
  type LoreNode,
  type MechanicsTopicId,
  type TurnNodeRecord,
  type WorldRecord,
} from "../../types";
import { ChatComposer } from "../chat/ChatComposer";
import { ContextHealthModal } from "../chat/ContextHealthModal";
import { DirectorChoicesDrawer } from "../chat/DirectorChoicesDrawer";
import { GmTalkDrawer } from "../chat/GmTalkDrawer";
import { InspectorInternalsSection } from "../inspector/InspectorInternalsSection";
import { MapLinkInspectorSection } from "../map/MapLinkInspectorSection";
import { PartyManagementModal } from "../party/PartyManagementModal";
import { StoryModal } from "../story/StoryModal";
import { CodexCharacterDetail } from "../world/CodexCharacterDetail";
import { WorldCodexTab } from "../world/WorldCodexTab";
import { WorldInspectorModal } from "../world/WorldInspectorModal";
import { CampaignCharacterStateTab } from "../world/codexCharacter/CampaignCharacterStateTab";
import {
  CODEX_SECTIONS,
  countInvalidWorldLoreBySection,
  searchAllCodexEntries,
} from "../world/codexHelpers";
import { CodexMechanicsDetail } from "../world/mechanics/CodexMechanicsDetail";
import {
  MECHANICS_ARTICLES,
  MECHANICS_SUBCATEGORIES,
} from "../world/mechanics/mechanicsCatalog";
import {
  DEFAULT_MECHANICS_SUBCATEGORY_ID,
  DEFAULT_MECHANICS_TOPIC_ID,
  buildMechanicsTree,
  collectAllMechanicsSubcategoryIds,
  flattenVisibleMechanicsTree,
  getMechanicsArticle,
  searchMechanicsArticles,
} from "../world/mechanics/mechanicsHelpers";

function makeLore(): LoreNode[] {
  return [
    {
      id: "lore_1",
      world_id: "w1",
      title: "Blackout Charter",
      category: "history",
      content: "Signed after the blackout.",
      entity_tags: ["blackout"],
    },
    {
      id: "lore_2",
      world_id: "w1",
      title: "Sector 9 Threat Watch",
      category: "threat",
      content: "Patrol drones sweep the catwalk.",
      entity_tags: ["threat", "drones"],
    },
  ];
}

function makeChar(): CharacterRecord {
  return {
    id: "char_yulia",
    version: 1,
    world_id: "w1",
    name: "Yulia Halim",
    tagline: "Ex-corporate surgeon",
    core_persona: "Watchful and precise.",
    communication_style: ["Terse"],
    quirks_flaws: ["Checks exits"],
    moral_code: ["Never abandon patients"],
    baseline_psyche: {
      mood_label: "Guarded",
      valence: -0.1,
      arousal: 0.4,
      core_drive: "Stay hidden",
      core_fear: "Corporate extraction",
      default_want: "Watch the room",
      default_plan: "Keep distance",
      temperament: {
        archetype: "paranoiac",
        relational_inertia: 0.88,
        negativity_ratio: 8.0,
        theta_pos_base: 0.28,
        theta_neg_base: -0.06,
        composure_resilience: 0.8,
      },
    },
    voice_anchors: [],
    equipped: [],
    inventory: [],
    memory_shards: [],
    initial_message: "Keep your voice low.",
    tags: ["surgeon"],
    creator: "test",
    creator_notes: "",
    portraits: {},
    gallery: [],
    created_at: "2026-01-01T00:00:00Z",
  };
}

function makeState(): CharacterStateSnapshot {
  return {
    turn_id: "t1",
    character_id: "char_yulia",
    current_location_id: "loc_1",
    mood_label: "Alert",
    valence: 0.15,
    arousal: 0.55,
    active_want: "Verify credentials",
    active_plan: "Watch hands",
    relationship_notes: {},
    inventory: [],
    unlocked_persona_keys: ["age"],
    persona_knowledge_provenance: {
      age: { learned_from: "player", unlocked_at_turn_id: "t1" },
    },
    care_state: {
      schema_version: 1,
      is_provisional: false,
      state_elapsed_minutes: 10,
      valence: 0.15,
      arousal: 0.55,
      dominance: 0.1,
      composure: 0.72,
      mood_variance: [0.05, 0.05, 0.05],
      active_emotion: "default",
      short_mood_label: "Alert",
      outward_demeanor: "Measured stillness",
      active_worldview: { benevolence: -0.6, belonging: -0.4, agency: 0.3 },
      appraisal: { threat: 0.35, coping: 0.25, goal_congruence: 0.1, ambiguity: 0.2 },
      relations: {
        user: {
          target_id: "user",
          warmth: 0.2,
          respect: 0.35,
          trust: 0.05,
          power: 0.0,
          grievance: 0.0,
          obligation: 0.1,
          consolidated_warmth: 0.1,
          consolidated_trust: 0.05,
          episodic_note: "Careful first contact.",
        },
      },
    },
  };
}

function makeBundle(char: CharacterRecord, state: CharacterStateSnapshot): CampaignStateBundle {
  const loc: LocationNode = {
    id: "loc_1",
    world_id: "w1",
    name: "The Neon Rust",
    summary: "Dim bar",
    description: "Flickering signage.",
    environmental_tags: ["neon"],
    is_starting_location: true,
  };
  const turn: TurnNodeRecord = {
    id: "t1",
    campaign_id: "camp_1",
    parent_turn_id: null,
    depth_index: 0,
    user_message: "",
    actor_id: char.id,
    raw_prose: "She looks up.",
    cognition: {
      recall: "",
      feeling: "alert",
      valence: 0.15,
      arousal: 0.55,
      want: "watch",
      plan: "wait",
    },
    pre_turn: {
      user_sentiment: "neutral",
      subtext_interpretation: "",
      mentioned_entities: [],
      memory_search_queries: [],
      spatial_intent: "stay",
      mechanics_check: {
        requires_roll: false,
        action_description: "",
        skill_or_approach: "",
        difficulty_class: 12,
        relevant_modifier: 0,
      },
    },
    world_snapshot: {
      turn_id: "t1",
      world_timestamp: "Day 1 20:00",
      active_location_id: loc.id,
      scene_flags: ["rain_outside"],
      campaign_elapsed_minutes: 0,
      visited_location_ids: [loc.id],
      parties: [],
    },
    character_state: state,
    character_states: { [char.id]: state },
    recalled_items: [],
    created_at: "2026-01-01T00:00:00Z",
  };
  return {
    campaign: {
      id: "camp_1",
      name: "Green Lie Run",
      world_id: "w1",
      character_id: char.id,
      participant_character_ids: [char.id],
      active_leaf_turn_id: "t1",
      world_name: "The Green Lie",
      created_at: "2026-01-01T00:00:00Z",
    },
    active_location: loc,
    visible_locations: [loc],
    neighbor_locations: [],
    current_world_snapshot: turn.world_snapshot,
    current_character_state: state,
    character_states: { [char.id]: state },
    character_records: { [char.id]: char },
    present_character_ids: [char.id],
    active_branch_turns: [turn],
    all_turn_nodes: [turn],
    episodic_chunks: [],
  };
}

describe("Codex Game Mechanics Catalog & Helpers (v0.40.0)", () => {
  it("contains all 7 subcategories and 24 valid unique articles with non-empty fields and valid cross-links", () => {
    expect(MECHANICS_SUBCATEGORIES).toHaveLength(7);
    expect(MECHANICS_ARTICLES).toHaveLength(24);

    const ids = new Set(MECHANICS_ARTICLES.map((a) => a.id));
    expect(ids.size).toBe(24);

    for (const article of MECHANICS_ARTICLES) {
      expect(article.title.trim().length).toBeGreaterThan(0);
      expect(article.inOneLine.trim().length).toBeGreaterThan(0);
      expect(article.keywords.length).toBeGreaterThan(0);
      expect(article.howItChanges.length).toBeGreaterThan(0);
      expect(article.effectOnPlay.length).toBeGreaterThan(0);
      for (const relId of article.relatedTopicIds) {
        expect(ids.has(relId)).toBe(true);
        expect(relId).not.toBe(article.id);
      }
    }
  });

  it("orders CARE articles in Layer 1->4 progression and embeds all 6 Temperament archetypes", () => {
    const careArticles = MECHANICS_ARTICLES.filter((a) => a.subcategoryId === "care");
    expect(careArticles.map((a) => a.id)).toEqual([
      "care-overview",
      "care-worldview-temperament",
      "care-mood-composure",
      "care-scene-appraisal",
      "care-dyadic-bonds",
    ]);

    const worldviewArticle = getMechanicsArticle("care-worldview-temperament");
    expect(worldviewArticle).toBeDefined();
    const scaleText = (worldviewArticle?.scales ?? []).map((s) => s.label).join(" | ");
    for (const preset of TEMPERAMENT_ARCHETYPE_OPTIONS) {
      expect(scaleText).toContain(preset.label);
    }
  });

  it("builds a 2-level mechanics tree, supports filtering + auto-expansion, and flattens visible leaves", () => {
    const full = buildMechanicsTree();
    expect(full.roots).toHaveLength(7);
    expect(collectAllMechanicsSubcategoryIds(full.roots)).toHaveLength(7);

    const defaultVisible = flattenVisibleMechanicsTree(
      full.roots,
      new Set([DEFAULT_MECHANICS_SUBCATEGORY_ID])
    );
    expect(defaultVisible).toHaveLength(5);
    expect(defaultVisible[0].topicId).toBe(DEFAULT_MECHANICS_TOPIC_ID);

    const filtered = buildMechanicsTree("composure");
    expect(filtered.roots.length).toBeGreaterThan(0);
    expect(filtered.autoExpandedSubcategoryIds.has("care")).toBe(true);
    const expandedFlat = flattenVisibleMechanicsTree(
      filtered.roots,
      filtered.autoExpandedSubcategoryIds
    );
    expect(expandedFlat.some((n) => n.topicId === "care-mood-composure")).toBe(true);
  });

  it("ranks Title hits ahead of Keyword and Content hits in searchMechanicsArticles", () => {
    const hits = searchMechanicsArticles("composure");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].topicId).toBe("care-mood-composure");
    expect(hits[0].matchTier).toBe(1);
  });

  it("keeps CODEX_SECTIONS (6 world cards) and world validation untouched, and partitions Global Search cleanly", () => {
    expect(CODEX_SECTIONS).toHaveLength(6);
    const lore = makeLore();
    const counts = countInvalidWorldLoreBySection(lore);
    expect(counts).toEqual({
      history_culture: 0,
      factions_figures: 0,
      items_artifacts: 0,
      rumors_threats: 0,
    });

    const worldHits = searchAllCodexEntries({
      loreNodes: lore,
      containers: [],
      locations: [],
      query: "threat",
      isCampaignMode: true,
    });
    const mechHits = searchMechanicsArticles("threat");
    expect(worldHits).toHaveLength(1);
    expect(worldHits[0].title).toBe("Sector 9 Threat Watch");
    expect(mechHits.length).toBeGreaterThan(0);
    // Mechanics hits stay strictly excluded from world search results
    expect(worldHits.every((h) => !h.key.startsWith("mechanics:"))).toBe(true);
  });
});

describe("Codex Game Mechanics UI & Contextual ? Deep-Links (SSR)", () => {
  const noop = () => {};

  it("renders the 6-card Hub grid + Game Mechanics Reference shelf across both Campaign and World Edit modes without changing World Codex count", () => {
    const loreNodes = makeLore();
    for (const isCampaignMode of [true, false]) {
      const html = renderToStaticMarkup(
        <WorldCodexTab
          worldId="w1"
          isActive={true}
          isCampaignMode={isCampaignMode}
          loreNodes={loreNodes}
          pendingWorldLoreTagDrafts={{}}
          containers={[]}
          locations={[]}
          onUpdateLoreNodes={noop}
          onUpdatePendingTagDrafts={noop}
          onMarkDirty={noop}
          onOpenOnMap={noop}
        />
      );
      expect(html).toContain(`World Codex (${loreNodes.length})`);
      expect(html).toContain("codex-hub-shelf");
      expect(html).toContain("Game Mechanics");
      expect(html).toContain("Reference");
      expect(html).toContain("7 topics · 24 guides");
      expect(html).toContain("CARE");
      expect(html).toContain("Dice &amp; Choices");
    }
  });

  it("renders 2-pane Game Mechanics tree with CARE expanded by default, separated pill, Under the Hood drawer, Related Topics, and Return button", () => {
    const loreNodes = makeLore();
    const mechanicsHtml = renderToStaticMarkup(
      <WorldCodexTab
        worldId="w1"
        isActive={true}
        isCampaignMode={true}
        loreNodes={loreNodes}
        pendingWorldLoreTagDrafts={{}}
        containers={[]}
        locations={[]}
        externalFocusRequest={{
          kind: "mechanics",
          topicId: "care-dyadic-bonds",
          returnTarget: {
            kind: "character",
            characterId: "char_yulia",
            subtab: "current",
            label: "Yulia Halim (Current)",
          },
          nonce: 1,
        }}
        onUpdateLoreNodes={noop}
        onUpdatePendingTagDrafts={noop}
        onMarkDirty={noop}
        onOpenOnMap={noop}
      />
    );
    expect(mechanicsHtml).toContain("codex-pill-divider");
    expect(mechanicsHtml).toContain("Return to Yulia Halim (Current)");
    expect(mechanicsHtml).toContain("Dyadic Relational Bonds (Layer 4)");
    expect(mechanicsHtml).toContain("CARE (Emotions &amp; Bonds)");
    expect(mechanicsHtml).toContain("Indebted (+)");
    expect(mechanicsHtml).toContain("Related Topics");
    expect(mechanicsHtml).not.toContain("Add Entry");

    const careArticle = getMechanicsArticle("care-mood-composure")!;
    const detailHtml = renderToStaticMarkup(
      <CodexMechanicsDetail
        article={careArticle}
        onSelectTopic={noop}
        initialUnderTheHoodOpen={true}
      />
    );
    expect(detailHtml).toContain("Under the Hood");
    expect(detailHtml).toContain("Composure &lt; 35% (0.35)");
    expect(detailHtml).toContain("Shock Bypass (Psi)");
  });

  it("renders world canon hits above the Game Mechanics group header when Global Search matches both", () => {
    const loreNodes = makeLore();
    const searchHtml = renderToStaticMarkup(
      <WorldCodexTab
        worldId="w1"
        isActive={true}
        isCampaignMode={true}
        loreNodes={loreNodes}
        pendingWorldLoreTagDrafts={{}}
        containers={[]}
        locations={[]}
        initialGlobalQuery="threat"
        onUpdateLoreNodes={noop}
        onUpdatePendingTagDrafts={noop}
        onMarkDirty={noop}
        onOpenOnMap={noop}
      />
    );
    const worldIdx = searchHtml.indexOf("Sector 9 Threat Watch");
    const groupIdx = searchHtml.indexOf("codex-search-group-header");
    const mechIdx = searchHtml.indexOf("Scene Appraisal &amp; Intent");
    expect(worldIdx).toBeGreaterThan(-1);
    expect(groupIdx).toBeGreaterThan(worldIdx);
    expect(mechIdx).toBeGreaterThan(groupIdx);
    expect(searchHtml).toContain("Game Mechanics (");
  });

  it("renders contextual ? MechanicsHelpButton triggers across CARE, Character Personality, Context Health, Internals, Choices, Party, Story, GM Talk, and Map Links", () => {
    const onHelp = vi.fn<(topicId: MechanicsTopicId) => void>();
    const char = makeChar();
    const state = makeState();
    const bundle = makeBundle(char, state);

    const stateHtml = renderToStaticMarkup(
      <CampaignCharacterStateTab
        character={char}
        state={state}
        isPresent={true}
        characterNameMap={{ [char.id]: char.name }}
        onOpenMechanicsHelp={onHelp}
        isActive={true}
      />
    );
    expect(stateHtml).toContain("Learn about Mood &amp; Composure (PAD)");
    expect(stateHtml).toContain("Learn about Scene Appraisal &amp; Intent");
    expect(stateHtml).toContain("Learn about Worldview &amp; Temperament");
    expect(stateHtml).toContain("Learn about Dyadic Relational Bonds");
    expect(stateHtml).toContain("Learn about Knowledge of You &amp; Gossip");

    const charHtml = renderToStaticMarkup(
      <CodexCharacterDetail
        kind="character"
        characterEntry={{ record: char, state, isPresent: true, isPrimary: true }}
        loreNodes={[]}
        onJumpToLore={noop}
        initialSubtab="personality"
        onOpenMechanicsHelp={onHelp}
      />
    );
    expect(charHtml).toContain("Learn about Worldview &amp; Temperament");

    const contextHtml = renderToStaticMarkup(
      <ContextHealthModal
        isOpen={true}
        onClose={noop}
        telemetry={null}
        onOpenMechanicsHelp={onHelp}
      />
    );
    expect(contextHtml).toContain("Learn about Context Health &amp; 4-Zone Economy");

    const internalsHtml = renderToStaticMarkup(
      <InspectorInternalsSection
        bundle={bundle}
        turnsCount={1}
        indexedCount={2}
        sceneFlags={["rain_outside"]}
        recalledItems={[]}
        flagsChanged={false}
        showAllFlags={false}
        setShowAllFlags={noop}
        expandedRecalls={new Set()}
        toggleRecall={noop}
        onOpenLoreIndex={noop}
        onOpenMechanicsHelp={onHelp}
      />
    );
    expect(internalsHtml).toContain("Learn about Lore Recall, Secrets &amp; Scene Flags");

    const choicesHtml = renderToStaticMarkup(
      <DirectorChoicesDrawer
        presentCharacters={[char]}
        stagedChoices={{}}
        activeChoiceCharId={char.id}
        setActiveChoiceCharId={noop}
        activeCharRecord={char}
        totalStagedOptionsCount={0}
        diceMode="auto"
        choicePreview={null}
        onClearAll={noop}
        onClearChar={noop}
        onSetDC={noop}
        onAddOption={noop}
        onUpdateOption={noop}
        onRemoveOption={noop}
        onClose={noop}
        onOpenMechanicsHelp={onHelp}
      />
    );
    expect(choicesHtml).toContain("Learn about Director Choices");

    const partyHtml = renderToStaticMarkup(
      <PartyManagementModal
        isOpen={true}
        onClose={noop}
        parties={[]}
        activeLocationId="loc_1"
        locations={bundle.visible_locations}
        presentCharacterIds={[char.id]}
        characterRecords={{ [char.id]: char }}
        characterStates={{ [char.id]: state }}
        onSubmitPartyTurn={noop}
        onOverrideCharacterLocation={noop}
        onCreateNpcParty={noop}
        onDisbandNpcParty={noop}
        onOpenMechanicsHelp={onHelp}
      />
    );
    expect(partyHtml).toContain("Learn about Parties &amp; Strict Co-Location");

    const storySummaryHtml = renderToStaticMarkup(
      <StoryModal
        isOpen={true}
        initialTab="summary"
        onClose={noop}
        bundle={bundle}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
        onOpenMechanicsHelp={onHelp}
      />
    );
    expect(storySummaryHtml).toContain("Learn about How the AI Remembers (3-Tier Memory)");

    const storyTimelineHtml = renderToStaticMarkup(
      <StoryModal
        isOpen={true}
        initialTab="timelines"
        onClose={noop}
        bundle={bundle}
        onZoomToTurn={noop}
        onSwitchTimeline={noop}
        onBranchFromTurn={noop}
        onOpenMechanicsHelp={onHelp}
      />
    );
    expect(storyTimelineHtml).toContain("Learn about Branching, Swiping &amp; Editing");

    const gmHtml = renderToStaticMarkup(
      <GmTalkDrawer
        campaignTitle="Green Lie Run"
        worldName="The Green Lie"
        unlockLore={false}
        isClosing={false}
        isExpanded={false}
        isCampaignStreaming={false}
        messages={[]}
        isLoading={false}
        isStreaming={false}
        streamingText=""
        streamingSources={[]}
        error={null}
        clearConfirm={false}
        isClearing={false}
        copiedId={null}
        expandedSources={{}}
        modelMeta={null}
        onInsertAtTrigger={noop}
        onClearChat={noop}
        onCopyMessage={noop}
        onToggleSources={noop}
        onDismissError={noop}
        onToggleExpanded={noop}
        onMinimize={noop}
        onOpenMechanicsHelp={onHelp}
      />
    );
    expect(gmHtml).toContain("Learn about GM Talk (Neuromancer)");

    const edge: LocationEdge = {
      id: "e1",
      world_id: "w1",
      from_location_id: "loc_1",
      to_location_id: "loc_2",
      direction_label: "North",
      compass_direction: "N",
      distance_meters: 100,
      speed_modifier: 1,
      obstacles: [],
      is_blocked: false,
      is_secret: false,
    };
    const linkHtml = renderToStaticMarkup(
      <MapLinkInspectorSection
        mode="editor"
        allLocations={[
          bundle.active_location,
          { ...bundle.active_location, id: "loc_2", name: "Back Alley", is_starting_location: false },
        ]}
        selectedEdgePair={{ pairKey: "loc_1<->loc_2", primary: edge, reciprocal: null }}
        onClose={noop}
        onOpenMechanicsHelp={onHelp}
      />
    );
    expect(linkHtml).toContain("Learn about Links, Travel Time &amp; Secret Passages");

    const composerHtml = renderToStaticMarkup(
      <ChatComposer
        composerBarRef={{ current: null }}
        narratorBtnRef={{ current: null }}
        exitsBtnRef={{ current: null }}
        textareaRef={{ current: null }}
        character={char}
        editingTurn={null}
        activeTray="none"
        setActiveTray={noop}
        activePopover="none"
        setActivePopover={noop}
        customDirectiveText=""
        setCustomDirectiveText={noop}
        presentCharacters={[char]}
        allCampaignCharacters={[char]}
        presentCharacterIds={[char.id]}
        stagedChoices={{}}
        activeChoiceCharId={char.id}
        setActiveChoiceCharId={noop}
        activeCharRecord={char}
        totalStagedOptionsCount={0}
        diceMode="auto"
        setDiceMode={noop}
        diceOverride=""
        setDiceOverride={noop}
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
        setMentionPickerOpen={noop}
        mentionQuery=""
        mentionSelectedIndex={0}
        setMentionSelectedIndex={noop}
        filteredMentionCharacters={[]}
        inputText=""
        setInputText={noop}
        isBusy={false}
        magicWand={{
          status: "idle",
          error: null,
          canEnrich: false,
          canRevert: false,
          isDirtyAfterApply: false,
          triggerEnrich: async () => {},
          cancelEnrich: noop,
          revert: noop,
          dismissUndo: noop,
          reset: noop,
        }}
        activeLocationName="The Neon Rust"
        neighborLocations={[]}
        handleSelectMention={noop}
        handleRemoveMentionChip={noop}
        checkAndTriggerMention={noop}
        handleInvokeNarrator={noop}
        handleQuickExit={noop}
        handleSendCustomDirective={noop}
        handleClearAllChoices={noop}
        handleClearCharChoices={noop}
        handleSetDC={noop}
        handleAddOption={noop}
        handleUpdateOption={noop}
        handleRemoveOption={noop}
        handleCancelEdit={noop}
        handleSend={noop}
        onOpenMechanicsHelp={onHelp}
      />
    );
    expect(composerHtml).toContain("Learn about d20 Modes &amp; Checks");

    const world: WorldRecord = {
      id: "w1",
      name: "The Green Lie",
      global_rules: {
        genre: "Cyberpunk",
        tone: "Noir",
        tech_or_magic_rules: "Cybernetic implants",
        setting_overview: "Arcology",
        starting_timestamp: "Day 1 20:00",
      },
      locations: [bundle.active_location],
      edges: [],
      lore_nodes: makeLore(),
      created_at: "2026-01-01T00:00:00Z",
    };
    const settingsHtml = renderToStaticMarkup(
      <WorldInspectorModal
        world={world}
        mode="campaign"
        initialTab="settings"
        onClose={noop}
        onSaved={noop}
      />
    );
    expect(settingsHtml).toContain("Learn about Unlock Lore &amp; Secrets (GM Mode)");
  });
});
