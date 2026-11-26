import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Compass,
  Gem,
  Info,
  Layers,
  MapPin,
  Plus,
  ScrollText,
  Search,
  Shield,
  Skull,
  User,
  UserCheck,
  X,
} from "lucide-react";
import { api } from "../../api";
import type {
  CodexReturnTarget,
  ItemEquipActionPayload,
  LocationContainer,
  LocationLoreNodeDraft,
  LocationNode,
  LoreNode,
  MechanicsSubcategoryId,
  MechanicsTopicId,
  MemoryShard,
  PersonaRecord,
  PersonaTurnStateSnapshot,
  PhysicalStateOverridePayload,
  TurnNodeRecord,
  WorldLoreCategory,
} from "../../types";
import { isEditableKeyboardTarget } from "../map/mapGeometry";
import { ImageLightboxModal } from "../shared/ImageLightboxModal";
import {
  CodexCharacterDetail,
  type CodexCharacterSubtab,
} from "./CodexCharacterDetail";
import { CodexLocationDetail } from "./CodexLocationDetail";
import { CodexLoreEditor } from "./CodexLoreEditor";
import {
  CODEX_SECTIONS,
  CodexCampaignCharacterEntry,
  CodexLocationTreeNode,
  CodexSearchHit,
  CodexSectionId,
  EditableCodexSectionId,
  MECHANICS_SECTION_META,
  buildCodexLocationTree,
  buildCodexMajorCharacterList,
  collectAllContainerIds,
  countInvalidWorldLoreBySection,
  filterAndRankWorldLore,
  flattenVisibleLocationTree,
  flushWorldLoreTags,
  getCodexSectionForCategory,
  getCodexSectionMeta,
  getLoreCategoryLabel,
  getLoreDisplayTitle,
  isEditableCodexSection,
  searchAllCodexEntries,
} from "./codexHelpers";
import { CodexMechanicsDetail } from "./mechanics/CodexMechanicsDetail";
import {
  MECHANICS_ARTICLES,
  MECHANICS_SUBCATEGORIES,
} from "./mechanics/mechanicsCatalog";
import {
  DEFAULT_MECHANICS_SUBCATEGORY_ID,
  DEFAULT_MECHANICS_TOPIC_ID,
  buildMechanicsTree,
  collectAllMechanicsSubcategoryIds,
  extractMechanicsTopicIdFromKey,
  flattenVisibleMechanicsTree,
  getMechanicsArticle,
  searchMechanicsArticles,
} from "./mechanics/mechanicsHelpers";

export type CodexFocusRequest =
  | { kind?: "lore"; loreId: string; nonce: number }
  | {
      kind: "character";
      characterId: string;
      initialSubtab?: CodexCharacterSubtab;
      nonce: number;
    }
  | {
      kind: "persona";
      personaId: string;
      nonce: number;
    }
  | {
      kind: "mechanics";
      topicId: MechanicsTopicId;
      returnTarget?: CodexReturnTarget | null;
      nonce: number;
    };

interface WorldCodexTabProps {
  worldId: string;
  isActive: boolean;
  isCampaignMode: boolean;
  unlockLore?: boolean;
  revealedLoreIds?: readonly string[];
  isMutatingLocked?: boolean;
  campaignId?: string;
  loreNodes: LoreNode[];
  pendingWorldLoreTagDrafts: Record<string, string>;
  containers: LocationContainer[];
  locations: LocationNode[];
  visitedContainerIds?: string[];
  activeLocationId?: string;
  activeWorldName?: string;
  activePersona?: PersonaRecord | null;
  activePersonaTurnState?: PersonaTurnStateSnapshot | null;
  campaignCharacters?: CodexCampaignCharacterEntry[];
  characterNameMap?: Record<string, string>;
  activeBranchTurns?: readonly TurnNodeRecord[];
  externalFocusRequest?: CodexFocusRequest | null;
  initialSection?: CodexSectionId | null;
  initialGlobalQuery?: string;
  initialExpandedContainerIds?: readonly string[];
  initialMobilePane?: "list" | "detail";
  onUpdateLoreNodes: (updater: (prev: LoreNode[]) => LoreNode[]) => void;
  onUpdatePendingTagDrafts: (
    updater: (prev: Record<string, string>) => Record<string, string>
  ) => void;
  onMarkDirty: () => void;
  onOpenOnMap: (kind: "location" | "container", id: string) => void;
  onSaveCampaignLocationLore?: (
    locationId: string,
    drafts: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onSaveCampaignContainerLore?: (
    containerId: string,
    drafts: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onToggleLoreReveal?: (
    loreId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onItemAction?: (payload: ItemEquipActionPayload) => Promise<void> | void;
  onSaveMemories?: (characterId: string, shards: MemoryShard[]) => Promise<void>;
  onRelocateCharacter?: (characterId: string, locationId: string) => Promise<void> | void;
  onOverrideCharacterPhysicalState?: (
    characterId: string,
    payload: PhysicalStateOverridePayload
  ) => Promise<void> | void;
  onOverridePlayerPhysicalState?: (
    payload: PhysicalStateOverridePayload
  ) => Promise<void> | void;
  onReturnToWorldTab?: (tab: "map" | "settings") => void;
}

const SECTION_ICON: Record<CodexSectionId, React.ReactNode> = {
  history_culture: <ScrollText size={16} color="var(--accent-emerald)" />,
  factions_figures: <Shield size={16} color="var(--accent-violet)" />,
  locations: <MapPin size={16} color="var(--accent-cyan)" />,
  items_artifacts: <Gem size={16} color="var(--accent-amber)" />,
  major_characters: <UserCheck size={16} color="var(--accent-cyan)" />,
  rumors_threats: <Skull size={16} color="var(--accent-amber)" />,
  mechanics: <Compass size={16} color="var(--accent-cyan)" />,
};

export const WorldCodexTab: React.FC<WorldCodexTabProps> = ({
  worldId,
  isActive,
  isCampaignMode,
  unlockLore = false,
  revealedLoreIds = [],
  isMutatingLocked = false,
  campaignId,
  loreNodes,
  pendingWorldLoreTagDrafts,
  containers,
  locations,
  visitedContainerIds = [],
  activeLocationId,
  activeWorldName,
  activePersona,
  activePersonaTurnState,
  campaignCharacters = [],
  characterNameMap,
  activeBranchTurns = [],
  externalFocusRequest,
  initialSection = null,
  initialGlobalQuery = "",
  initialExpandedContainerIds,
  initialMobilePane,
  onUpdateLoreNodes,
  onUpdatePendingTagDrafts,
  onMarkDirty,
  onOpenOnMap,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
  onToggleLoreReveal,
  onItemAction,
  onSaveMemories,
  onRelocateCharacter,
  onOverrideCharacterPhysicalState,
  onOverridePlayerPhysicalState,
  onReturnToWorldTab,
}) => {
  const canEditWorldLore = !isCampaignMode || (unlockLore && !isMutatingLocked);
  const [activeSection, setActiveSection] = useState<CodexSectionId | null>(() => {
    if (
      externalFocusRequest?.kind === "character" ||
      externalFocusRequest?.kind === "persona"
    ) {
      return "major_characters";
    }
    if (externalFocusRequest?.kind === "mechanics") {
      return "mechanics";
    }
    if (externalFocusRequest && "loreId" in externalFocusRequest) {
      const target = loreNodes.find((ln) => ln.id === externalFocusRequest.loreId);
      if (target) return getCodexSectionForCategory(target.category);
    }
    return initialSection;
  });
  const [globalQuery, setGlobalQuery] = useState(initialGlobalQuery);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(() => {
    if (externalFocusRequest?.kind === "character") {
      return `character:${externalFocusRequest.characterId}`;
    }
    if (externalFocusRequest?.kind === "persona") {
      return `persona:${externalFocusRequest.personaId}`;
    }
    if (externalFocusRequest?.kind === "mechanics") {
      return `mechanics:${externalFocusRequest.topicId}`;
    }
    if (externalFocusRequest && "loreId" in externalFocusRequest) {
      return externalFocusRequest.loreId;
    }
    if (initialSection === "mechanics") {
      return `mechanics:${DEFAULT_MECHANICS_TOPIC_ID}`;
    }
    return null;
  });
  const [charFocusTarget, setCharFocusTarget] = useState<{
    characterId: string;
    subtab: CodexCharacterSubtab;
    nonce: number;
  } | null>(() =>
    externalFocusRequest?.kind === "character"
      ? {
          characterId: externalFocusRequest.characterId,
          subtab: externalFocusRequest.initialSubtab ?? "bio",
          nonce: externalFocusRequest.nonce,
        }
      : null
  );
  const [expandedContainerIds, setExpandedContainerIds] = useState<Set<string>>(
    () => new Set(initialExpandedContainerIds ?? [])
  );
  const [expandedMechanicsSubcats, setExpandedMechanicsSubcats] = useState<
    Set<MechanicsSubcategoryId>
  >(() => {
    const initialSubcat =
      externalFocusRequest?.kind === "mechanics"
        ? getMechanicsArticle(externalFocusRequest.topicId)?.subcategoryId ??
          DEFAULT_MECHANICS_SUBCATEGORY_ID
        : DEFAULT_MECHANICS_SUBCATEGORY_ID;
    return new Set([initialSubcat]);
  });
  const [mechanicsReturnTarget, setMechanicsReturnTarget] =
    useState<CodexReturnTarget | null>(() =>
      externalFocusRequest?.kind === "mechanics"
        ? externalFocusRequest.returnTarget ?? null
        : null
    );
  const [mobilePane, setMobilePane] = useState<"list" | "detail">(
    () => initialMobilePane ?? (externalFocusRequest ? "detail" : "list")
  );
  const [mobileTopicsSheetOpen, setMobileTopicsSheetOpen] = useState(false);
  const internalReturnNonceRef = useRef(0);
  const [frozenOrderIds, setFrozenOrderIds] = useState<string[] | null>(null);
  const [reclassifiedNotice, setReclassifiedNotice] = useState<{
    loreId: string;
    fromSectionLabel: string;
    toSectionLabel: string;
    previousCategory: WorldLoreCategory;
  } | null>(null);
  const [artifactUnlinkNotice, setArtifactUnlinkNotice] = useState<string | null>(
    null
  );
  const [lightboxImage, setLightboxImage] = useState<{
    url: string;
    label: string;
    videoUrl?: string | null;
    videoMimeType?: string | null;
  } | null>(null);
  const [fetchedPersonaState, setFetchedPersonaState] =
    useState<PersonaTurnStateSnapshot | null>(null);

  const globalSearchInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const duplicateSeqRef = useRef(0);
  const shouldFocusTitleRef = useRef(false);
  const shouldFocusGlobalSearchRef = useRef(false);

  const isGlobalSearchMode = activeSection === null && globalQuery.trim().length > 0;
  const isTwoPaneMode = activeSection !== null || isGlobalSearchMode;

  const invalidCountsBySection = useMemo(
    () =>
      !canEditWorldLore
        ? {
            history_culture: 0,
            factions_figures: 0,
            items_artifacts: 0,
            rumors_threats: 0,
          }
        : countInvalidWorldLoreBySection(loreNodes, pendingWorldLoreTagDrafts),
    [canEditWorldLore, loreNodes, pendingWorldLoreTagDrafts]
  );

  // Lazy load live persona turn state if omitted in campaign mode
  useEffect(() => {
    if (
      !isCampaignMode ||
      !activePersona ||
      activePersonaTurnState !== undefined ||
      !campaignId
    ) {
      return;
    }
    let cancelled = false;
    api
      .getCampaignPersonaState(campaignId)
      .then((snap) => {
        if (!cancelled) setFetchedPersonaState(snap);
      })
      .catch(() => {
        if (!cancelled) setFetchedPersonaState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isCampaignMode, activePersona, activePersonaTurnState, campaignId]);

  const effectivePersonaTurnState =
    activePersonaTurnState !== undefined
      ? activePersonaTurnState
      : fetchedPersonaState;

  // Handle external validation / right-pane focus jumps
  useEffect(() => {
    if (!externalFocusRequest) return;
    setMobileTopicsSheetOpen(false);
    if (externalFocusRequest.kind === "character") {
      setGlobalQuery("");
      setCategoryQuery("");
      setFrozenOrderIds(null);
      setReclassifiedNotice(null);
      setArtifactUnlinkNotice(null);
      setMechanicsReturnTarget(null);
      setActiveSection("major_characters");
      setSelectedEntryKey(`character:${externalFocusRequest.characterId}`);
      setMobilePane("detail");
      setCharFocusTarget({
        characterId: externalFocusRequest.characterId,
        subtab: externalFocusRequest.initialSubtab ?? "bio",
        nonce: externalFocusRequest.nonce,
      });
      return;
    }
    if (externalFocusRequest.kind === "persona") {
      setGlobalQuery("");
      setCategoryQuery("");
      setFrozenOrderIds(null);
      setReclassifiedNotice(null);
      setArtifactUnlinkNotice(null);
      setCharFocusTarget(null);
      setMechanicsReturnTarget(null);
      setActiveSection("major_characters");
      setSelectedEntryKey(`persona:${externalFocusRequest.personaId}`);
      setMobilePane("detail");
      return;
    }
    if (externalFocusRequest.kind === "mechanics") {
      const targetArticle = getMechanicsArticle(externalFocusRequest.topicId);
      const targetSubcat =
        targetArticle?.subcategoryId ?? DEFAULT_MECHANICS_SUBCATEGORY_ID;
      setGlobalQuery("");
      setCategoryQuery("");
      setFrozenOrderIds(null);
      setReclassifiedNotice(null);
      setArtifactUnlinkNotice(null);
      setCharFocusTarget(null);
      setActiveSection("mechanics");
      setExpandedMechanicsSubcats((prev) => new Set([...prev, targetSubcat]));
      setSelectedEntryKey(
        `mechanics:${targetArticle?.id ?? DEFAULT_MECHANICS_TOPIC_ID}`
      );
      setMobilePane("detail");
      setMechanicsReturnTarget(externalFocusRequest.returnTarget ?? null);
      return;
    }
    const target = loreNodes.find((ln) => ln.id === externalFocusRequest.loreId);
    if (!target) return;
    const secId = getCodexSectionForCategory(target.category);
    setGlobalQuery("");
    setCategoryQuery("");
    setFrozenOrderIds(null);
    setCharFocusTarget(null);
    setMechanicsReturnTarget(null);
    setActiveSection(secId);
    setSelectedEntryKey(target.id);
    setMobilePane("detail");
    setTimeout(() => titleInputRef.current?.focus(), 40);
  }, [externalFocusRequest, loreNodes]);

  useEffect(() => {
    if (!mobileTopicsSheetOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMobileTopicsSheetOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [mobileTopicsSheetOpen]);

  // Focus Global Quick Search when jumped via "Search all" with empty filter
  useEffect(() => {
    if (shouldFocusGlobalSearchRef.current && activeSection === null) {
      shouldFocusGlobalSearchRef.current = false;
      setTimeout(() => {
        globalSearchInputRef.current?.focus();
      }, 20);
    }
  }, [activeSection]);

  // Focus newly added title input when requested
  useEffect(() => {
    if (shouldFocusTitleRef.current) {
      shouldFocusTitleRef.current = false;
      setTimeout(() => {
        titleInputRef.current?.focus();
      }, 30);
    }
  }, [selectedEntryKey, activeSection]);

  // Previews for Hub cards
  const hubSectionData = useMemo(() => {
    const locTree = buildCodexLocationTree(containers, locations, {
      isCampaignMode,
      unlockLore,
      revealedLoreIds,
    });
    const castItems = isCampaignMode
      ? buildCodexMajorCharacterList(activePersona, campaignCharacters)
      : [];

    return CODEX_SECTIONS.map((sec) => {
      if (sec.id === "locations") {
        const preview = locTree.roots.slice(0, 3).map((n) => n.name || "Unnamed");
        const countText =
          containers.length > 0
            ? `${locations.length} ${locations.length === 1 ? "location" : "locations"} · ${containers.length} ${containers.length === 1 ? "area" : "areas"}`
            : `${locations.length} ${locations.length === 1 ? "location" : "locations"}`;
        return {
          sec,
          count: locations.length + containers.length,
          countText,
          invalidCount: 0,
          preview,
          disabled: false,
        };
      }
      if (sec.id === "major_characters") {
        const preview = isCampaignMode
          ? castItems.slice(0, 3).map((item) => item.title)
          : [];
        const charCount = campaignCharacters.length;
        const countText = !isCampaignMode
          ? "Campaign only"
          : activePersona
            ? `1 persona · ${charCount} ${charCount === 1 ? "character" : "characters"}`
            : `${charCount} ${charCount === 1 ? "character" : "characters"}`;
        return {
          sec,
          count: isCampaignMode ? castItems.length : 0,
          countText,
          invalidCount: 0,
          preview,
          disabled: !isCampaignMode,
        };
      }
      const editableId = sec.id as EditableCodexSectionId;
      const ranked = filterAndRankWorldLore(loreNodes, {
        sectionId: editableId,
        pendingDrafts: pendingWorldLoreTagDrafts,
      });
      return {
        sec,
        count: ranked.length,
        countText: `${ranked.length} ${ranked.length === 1 ? "entry" : "entries"}`,
        invalidCount: invalidCountsBySection[editableId] ?? 0,
        preview: ranked.slice(0, 3).map((r) => getLoreDisplayTitle(r.lore.title)),
        disabled: false,
      };
    });
  }, [
    containers,
    locations,
    isCampaignMode,
    unlockLore,
    revealedLoreIds,
    activePersona,
    campaignCharacters,
    loreNodes,
    pendingWorldLoreTagDrafts,
    invalidCountsBySection,
  ]);

  // Global Quick Search hits (world/campaign canon ranked first; Game Mechanics grouped below)
  const globalSearchHits = useMemo(() => {
    if (!isGlobalSearchMode) return [];
    return searchAllCodexEntries({
      loreNodes,
      containers,
      locations,
      activePersona,
      campaignCharacters,
      pendingDrafts: pendingWorldLoreTagDrafts,
      query: globalQuery,
      isCampaignMode,
      unlockLore,
      revealedLoreIds,
      frozenOrderIds,
    });
  }, [
    isGlobalSearchMode,
    loreNodes,
    containers,
    locations,
    activePersona,
    campaignCharacters,
    pendingWorldLoreTagDrafts,
    globalQuery,
    isCampaignMode,
    unlockLore,
    revealedLoreIds,
    frozenOrderIds,
  ]);

  const globalMechanicsHits = useMemo(() => {
    if (!isGlobalSearchMode) return [];
    return searchMechanicsArticles(globalQuery);
  }, [isGlobalSearchMode, globalQuery]);

  // Category-scoped items
  const editableLoreItems = useMemo(() => {
    if (!activeSection || !isEditableCodexSection(activeSection)) return [];
    return filterAndRankWorldLore(loreNodes, {
      sectionId: activeSection,
      query: categoryQuery,
      pendingDrafts: pendingWorldLoreTagDrafts,
      frozenOrderIds,
    });
  }, [
    activeSection,
    loreNodes,
    categoryQuery,
    pendingWorldLoreTagDrafts,
    frozenOrderIds,
  ]);

  const locationTree = useMemo(() => {
    if (activeSection !== "locations") {
      return { roots: [], autoExpandedContainerIds: new Set<string>() };
    }
    return buildCodexLocationTree(containers, locations, {
      query: categoryQuery,
      isCampaignMode,
      unlockLore,
      revealedLoreIds,
    });
  }, [
    activeSection,
    containers,
    locations,
    categoryQuery,
    isCampaignMode,
    unlockLore,
    revealedLoreIds,
  ]);

  // Auto-expand ancestor containers when searching in Locations
  const effectiveExpandedContainerIds = useMemo(() => {
    if (categoryQuery.trim()) {
      return new Set<string>([
        ...expandedContainerIds,
        ...locationTree.autoExpandedContainerIds,
      ]);
    }
    return expandedContainerIds;
  }, [expandedContainerIds, locationTree.autoExpandedContainerIds, categoryQuery]);

  const visibleLocationFlat = useMemo(() => {
    if (activeSection !== "locations") return [];
    return flattenVisibleLocationTree(
      locationTree.roots,
      effectiveExpandedContainerIds
    );
  }, [activeSection, locationTree.roots, effectiveExpandedContainerIds]);

  const majorCharacterItems = useMemo(() => {
    if (activeSection !== "major_characters" || !isCampaignMode) return [];
    return buildCodexMajorCharacterList(
      activePersona,
      campaignCharacters,
      categoryQuery
    );
  }, [
    activeSection,
    isCampaignMode,
    activePersona,
    campaignCharacters,
    categoryQuery,
  ]);

  const mechanicsTree = useMemo(() => {
    if (activeSection !== "mechanics") {
      return {
        roots: [],
        autoExpandedSubcategoryIds: new Set<MechanicsSubcategoryId>(),
      };
    }
    return buildMechanicsTree(categoryQuery);
  }, [activeSection, categoryQuery]);

  const effectiveExpandedMechanicsSubcats = useMemo(() => {
    if (categoryQuery.trim()) {
      return new Set<MechanicsSubcategoryId>([
        ...expandedMechanicsSubcats,
        ...mechanicsTree.autoExpandedSubcategoryIds,
      ]);
    }
    return expandedMechanicsSubcats;
  }, [
    expandedMechanicsSubcats,
    mechanicsTree.autoExpandedSubcategoryIds,
    categoryQuery,
  ]);

  const visibleMechanicsFlat = useMemo(() => {
    if (activeSection !== "mechanics") return [];
    return flattenVisibleMechanicsTree(
      mechanicsTree.roots,
      effectiveExpandedMechanicsSubcats
    );
  }, [activeSection, mechanicsTree.roots, effectiveExpandedMechanicsSubcats]);

  // Visible keys in order for auto-selection & ArrowUp/ArrowDown navigation
  const visibleRowKeys = useMemo<string[]>(() => {
    if (isGlobalSearchMode) {
      return [
        ...globalSearchHits.map((h) => h.key),
        ...globalMechanicsHits.map((h) => h.key),
      ];
    }
    if (!activeSection) return [];
    if (isEditableCodexSection(activeSection)) {
      return editableLoreItems.map((item) => item.lore.id);
    }
    if (activeSection === "locations") {
      return visibleLocationFlat.map((n) => n.key);
    }
    if (activeSection === "major_characters") {
      return majorCharacterItems.map((m) => m.key);
    }
    if (activeSection === "mechanics") {
      return visibleMechanicsFlat.map((m) => m.key);
    }
    return [];
  }, [
    isGlobalSearchMode,
    globalSearchHits,
    globalMechanicsHits,
    activeSection,
    editableLoreItems,
    visibleLocationFlat,
    majorCharacterItems,
    visibleMechanicsFlat,
  ]);

  // Reconcile selection when switching category, filtering, or mutating campaign roster
  useEffect(() => {
    if (!isTwoPaneMode) return;
    if (activeSection === "mechanics") {
      if (categoryQuery.trim()) {
        if (visibleRowKeys.length === 0) {
          if (selectedEntryKey !== null) setSelectedEntryKey(null);
        } else if (!selectedEntryKey || !visibleRowKeys.includes(selectedEntryKey)) {
          setSelectedEntryKey(visibleRowKeys[0]);
        }
      } else if (
        !selectedEntryKey ||
        !extractMechanicsTopicIdFromKey(selectedEntryKey)
      ) {
        setSelectedEntryKey(`mechanics:${DEFAULT_MECHANICS_TOPIC_ID}`);
      }
      return;
    }
    if (visibleRowKeys.length === 0) {
      if (selectedEntryKey !== null) setSelectedEntryKey(null);
      return;
    }
    if (!selectedEntryKey || !visibleRowKeys.includes(selectedEntryKey)) {
      setSelectedEntryKey(visibleRowKeys[0]);
    }
  }, [isTwoPaneMode, activeSection, categoryQuery, visibleRowKeys, selectedEntryKey]);

  const resolvedCharacterNameMap = useMemo(() => {
    if (characterNameMap && Object.keys(characterNameMap).length > 0) {
      return characterNameMap;
    }
    return Object.fromEntries(
      campaignCharacters.map((c) => [c.record.id, c.record.name])
    );
  }, [characterNameMap, campaignCharacters]);

  const selectEntryForDetail = (key: string, beforeSelect?: () => void) => {
    beforeSelect?.();
    setSelectedEntryKey(key);
    setMobilePane("detail");
    setMobileTopicsSheetOpen(false);
  };

  const handleOpenSection = (secId: CodexSectionId) => {
    const meta = getCodexSectionMeta(secId);
    if (meta.campaignOnly && !isCampaignMode) return;
    setGlobalQuery("");
    setCategoryQuery("");
    setFrozenOrderIds(null);
    setReclassifiedNotice(null);
    setArtifactUnlinkNotice(null);
    setCharFocusTarget(null);
    setMechanicsReturnTarget(null);
    setMobileTopicsSheetOpen(false);
    setMobilePane("list");
    setActiveSection(secId);
    if (secId === "mechanics") {
      setExpandedMechanicsSubcats((prev) =>
        prev.size > 0 ? prev : new Set([DEFAULT_MECHANICS_SUBCATEGORY_ID])
      );
      setSelectedEntryKey(`mechanics:${DEFAULT_MECHANICS_TOPIC_ID}`);
    } else {
      setSelectedEntryKey(null);
    }
  };

  const handleOpenMechanicsTopic = (
    topicId: MechanicsTopicId,
    returnTarget?: CodexReturnTarget | null
  ) => {
    const article = getMechanicsArticle(topicId);
    const subcatId =
      article?.subcategoryId ?? DEFAULT_MECHANICS_SUBCATEGORY_ID;
    setGlobalQuery("");
    setCategoryQuery("");
    setFrozenOrderIds(null);
    setReclassifiedNotice(null);
    setArtifactUnlinkNotice(null);
    setCharFocusTarget(null);
    setMobileTopicsSheetOpen(false);
    setMobilePane("detail");
    setActiveSection("mechanics");
    setExpandedMechanicsSubcats((prev) => new Set([...prev, subcatId]));
    setSelectedEntryKey(
      `mechanics:${article?.id ?? DEFAULT_MECHANICS_TOPIC_ID}`
    );
    if (returnTarget !== undefined) {
      setMechanicsReturnTarget(returnTarget);
    }
  };

  const handleReturnFromMechanics = () => {
    const target = mechanicsReturnTarget;
    if (!target) return;
    setMechanicsReturnTarget(null);
    setMobileTopicsSheetOpen(false);
    if (target.kind === "character") {
      setGlobalQuery("");
      setCategoryQuery("");
      setActiveSection("major_characters");
      setSelectedEntryKey(`character:${target.characterId}`);
      setMobilePane("detail");
      setCharFocusTarget({
        characterId: target.characterId,
        subtab: target.subtab,
        nonce: ++internalReturnNonceRef.current,
      });
      return;
    }
    if (target.kind === "persona") {
      setGlobalQuery("");
      setCategoryQuery("");
      setActiveSection("major_characters");
      setSelectedEntryKey(`persona:${target.personaId}`);
      setMobilePane("detail");
      return;
    }
    onReturnToWorldTab?.(target.tab);
  };

  const handleBackToHub = () => {
    setActiveSection(null);
    setGlobalQuery("");
    setCategoryQuery("");
    setFrozenOrderIds(null);
    setReclassifiedNotice(null);
    setArtifactUnlinkNotice(null);
    setCharFocusTarget(null);
    setMechanicsReturnTarget(null);
    setMobileTopicsSheetOpen(false);
    setMobilePane("list");
    setSelectedEntryKey(null);
  };

  const handleAddLoreEntry = (forcedSection?: EditableCodexSectionId) => {
    if (!canEditWorldLore) return;
    const targetSection: EditableCodexSectionId =
      forcedSection ??
      (activeSection && isEditableCodexSection(activeSection)
        ? activeSection
        : "history_culture");
    const sectionMeta = getCodexSectionMeta(targetSection);
    const defaultCat: WorldLoreCategory = sectionMeta.defaultCategory ?? "history";
    duplicateSeqRef.current += 1;
    const newId = `new_lore_${Date.now()}_${duplicateSeqRef.current}`;

    const newEntry: LoreNode = {
      id: newId,
      world_id: worldId,
      title: "",
      category: defaultCat,
      content: "",
      entity_tags: [],
    };

    onUpdateLoreNodes((prev) => [...prev, newEntry]);
    onMarkDirty();
    setGlobalQuery("");
    setCategoryQuery("");
    setFrozenOrderIds(null);
    setReclassifiedNotice(null);
    setArtifactUnlinkNotice(null);
    setMobileTopicsSheetOpen(false);
    setActiveSection(targetSection);
    setSelectedEntryKey(newId);
    setMobilePane("detail");
    shouldFocusTitleRef.current = true;
  };

  const handleUpdateLore = (
    loreId: string,
    patch: Partial<LoreNode>
  ) => {
    onUpdateLoreNodes((prev) =>
      prev.map((ln) => (ln.id === loreId ? { ...ln, ...patch } : ln))
    );
    onMarkDirty();
  };

  const handleCategoryChange = (
    lore: LoreNode,
    nextCategory: WorldLoreCategory
  ) => {
    if (lore.category === nextCategory) return;
    const prevCategory = lore.category as WorldLoreCategory;
    const prevSection = getCodexSectionForCategory(prevCategory);
    const nextSection = getCodexSectionForCategory(nextCategory);

    if (prevCategory === "artifact" && nextCategory !== "artifact") {
      setArtifactUnlinkNotice(
        "Reclassifying away from Artifact will unlink any character items referencing this entry on save."
      );
    } else {
      setArtifactUnlinkNotice(null);
    }

    handleUpdateLore(lore.id, { category: nextCategory });
    setFrozenOrderIds(null);

    if (activeSection !== null && prevSection !== nextSection) {
      setActiveSection(nextSection);
      setSelectedEntryKey(lore.id);
      setReclassifiedNotice({
        loreId: lore.id,
        fromSectionLabel: getCodexSectionMeta(prevSection).label,
        toSectionLabel: getCodexSectionMeta(nextSection).label,
        previousCategory: prevCategory,
      });
    } else {
      setReclassifiedNotice(null);
    }
  };

  const handleDuplicateLore = (source: LoreNode) => {
    if (!canEditWorldLore) return;
    duplicateSeqRef.current += 1;
    const newId = `new_lore_${Date.now()}_${duplicateSeqRef.current}`;
    const flushedTags = flushWorldLoreTags(
      source.entity_tags,
      pendingWorldLoreTagDrafts[source.id]
    );
    const baseTitle = source.title.trim();
    const copyTitle = baseTitle
      ? `${baseTitle.slice(0, 120 - " (Copy)".length)} (Copy)`
      : "";

    const duplicated: LoreNode = {
      id: newId,
      world_id: worldId,
      title: copyTitle,
      category: source.category,
      content: source.content,
      entity_tags: flushedTags,
    };

    onUpdateLoreNodes((prev) => [...prev, duplicated]);
    onMarkDirty();
    setFrozenOrderIds(null);
    setSelectedEntryKey(isGlobalSearchMode ? `lore:${newId}` : newId);
    shouldFocusTitleRef.current = true;
  };

  const handleDeleteLore = (target: LoreNode) => {
    if (!canEditWorldLore) return;
    const lookupKey = isGlobalSearchMode ? `lore:${target.id}` : target.id;
    const currentIdx = visibleRowKeys.indexOf(lookupKey);
    const nextNeighborId =
      visibleRowKeys[currentIdx + 1] ?? visibleRowKeys[currentIdx - 1] ?? null;

    if (target.category === "artifact") {
      setArtifactUnlinkNotice(
        `Deleted Artifact "${getLoreDisplayTitle(target.title)}". Any character items referencing it will be unlinked on save.`
      );
    }

    onUpdateLoreNodes((prev) => prev.filter((ln) => ln.id !== target.id));
    onUpdatePendingTagDrafts((prev) => {
      if (!(target.id in prev)) return prev;
      const copy = { ...prev };
      delete copy[target.id];
      return copy;
    });
    onMarkDirty();
    setFrozenOrderIds(null);
    if (reclassifiedNotice?.loreId === target.id) {
      setReclassifiedNotice(null);
    }
    setSelectedEntryKey(nextNeighborId);
  };

  const handleJumpToLoreId = (loreId: string) => {
    const target = loreNodes.find((ln) => ln.id === loreId);
    if (!target) return;
    setGlobalQuery("");
    setCategoryQuery("");
    setFrozenOrderIds(null);
    setCharFocusTarget(null);
    setActiveSection(getCodexSectionForCategory(target.category));
    setSelectedEntryKey(target.id);
  };

  const handleSearchInputKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    value: string,
    clear: () => void
  ) => {
    if (e.key === "Escape" && value.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      clear();
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isEditableKeyboardTarget(e.target, e.currentTarget)) return;
    if (visibleRowKeys.length === 0) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;

    e.preventDefault();
    const currIdx = selectedEntryKey ? visibleRowKeys.indexOf(selectedEntryKey) : -1;
    const nextIdx =
      e.key === "ArrowDown"
        ? currIdx < visibleRowKeys.length - 1
          ? currIdx + 1
          : 0
        : currIdx > 0
          ? currIdx - 1
          : visibleRowKeys.length - 1;
    setFrozenOrderIds(null);
    setSelectedEntryKey(visibleRowKeys[nextIdx]);
  };

  const renderLocationTreeNode = (
    node: CodexLocationTreeNode,
    depthIndent: number
  ): React.ReactNode => {
    const isExpanded =
      node.kind === "container" && effectiveExpandedContainerIds.has(node.id);
    const isSelected = selectedEntryKey === node.key;

    return (
      <React.Fragment key={node.key}>
        <div
          role="option"
          aria-selected={isSelected}
          tabIndex={0}
          className={`codex-list-row ${isSelected ? "active" : ""}`}
          style={{ paddingLeft: 8 + depthIndent * 14 }}
          onClick={() => selectEntryForDetail(node.key)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              selectEntryForDetail(node.key);
            }
          }}
        >
          {node.kind === "container" ? (
            <>
              <button
                type="button"
                className="codex-tree-toggle"
                aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedContainerIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  });
                }}
              >
                {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <Layers size={12} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
            </>
          ) : (
            <MapPin size={12} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
          )}

          <span className="codex-list-row-title">{node.name}</span>

          <div className="codex-list-row-meta">
            {node.localLoreCount > 0 && (
              <span
                className="codex-lore-indicator"
                title={`${node.localLoreCount} local lore ${
                  node.localLoreCount === 1 ? "entry" : "entries"
                }`}
                aria-label={`${node.localLoreCount} local lore ${
                  node.localLoreCount === 1 ? "entry" : "entries"
                }`}
              >
                <BookOpen size={11} />
              </span>
            )}
            {node.kind === "location" && (
              <>
                {activeLocationId && node.id === activeLocationId && (
                  <span className="badge codex-badge--amber">Current</span>
                )}
                {node.location?.is_starting_location && (
                  <span className="badge codex-badge--emerald">Start</span>
                )}
                {node.location?.is_hub && (
                  <span className="badge codex-badge--violet">Hub</span>
                )}
              </>
            )}
          </div>
        </div>

        {isExpanded &&
          node.children.map((child) => renderLocationTreeNode(child, depthIndent + 1))}
      </React.Fragment>
    );
  };

  const activeMechanicsArticle = useMemo(() => {
    if (activeSection !== "mechanics") return undefined;
    const selectedTopicId = extractMechanicsTopicIdFromKey(selectedEntryKey);
    return (
      (selectedTopicId ? getMechanicsArticle(selectedTopicId) : undefined) ??
      (!categoryQuery.trim()
        ? getMechanicsArticle(DEFAULT_MECHANICS_TOPIC_ID)
        : undefined)
    );
  }, [activeSection, selectedEntryKey, categoryQuery]);

  const renderMechanicsTreeContent = () => {
    if (mechanicsTree.roots.length === 0) {
      return (
        <div className="ui-empty-state ui-empty-state--fill">
          <span>No guides match &ldquo;{categoryQuery.trim()}&rdquo;.</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setCategoryQuery("")}
          >
            Clear filter
          </button>
        </div>
      );
    }
    return mechanicsTree.roots.map((group) => {
      const isExpanded = effectiveExpandedMechanicsSubcats.has(
        group.subcategoryId
      );
      const toggleGroup = () => {
        setExpandedMechanicsSubcats((prev) => {
          const next = new Set(prev);
          if (next.has(group.subcategoryId)) {
            next.delete(group.subcategoryId);
          } else {
            next.add(group.subcategoryId);
          }
          return next;
        });
      };
      return (
        <React.Fragment key={group.key}>
          <div
            className="codex-list-row codex-mechanics-group-row"
            style={{ paddingLeft: 8 }}
            title={group.subcategory.description}
            onClick={toggleGroup}
          >
            <button
              type="button"
              className="codex-tree-toggle"
              aria-expanded={isExpanded}
              aria-label={
                isExpanded
                  ? `Collapse ${group.subcategory.label}`
                  : `Expand ${group.subcategory.label}`
              }
              onClick={(e) => {
                e.stopPropagation();
                toggleGroup();
              }}
            >
              {isExpanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
            </button>
            <span className="codex-list-row-title">
              {group.subcategory.label}
            </span>
            <span className="codex-mechanics-group-count">
              {group.children.length}
            </span>
          </div>
          {isExpanded &&
            group.children.map((leaf) => {
              const isSelected = selectedEntryKey === leaf.key;
              return (
                <div
                  key={leaf.key}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`codex-list-row ${isSelected ? "active" : ""}`}
                  style={{ paddingLeft: 24 }}
                  onClick={() => selectEntryForDetail(leaf.key)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      selectEntryForDetail(leaf.key);
                    }
                  }}
                >
                  <Compass
                    size={12}
                    color="var(--accent-cyan)"
                    style={{ flexShrink: 0 }}
                  />
                  <span className="codex-list-row-title">{leaf.title}</span>
                </div>
              );
            })}
        </React.Fragment>
      );
    });
  };

  // Resolve active right-pane content
  const renderRightPane = () => {
    if (isGlobalSearchMode) {
      const hit: CodexSearchHit | undefined = globalSearchHits.find(
        (h) => h.key === selectedEntryKey
      );
      const mechHit = !hit
        ? globalMechanicsHits.find((m) => m.key === selectedEntryKey)
        : undefined;
      if (!hit && !mechHit) {
        const totalHits = globalSearchHits.length + globalMechanicsHits.length;
        return (
          <div className="ui-empty-state ui-empty-state--fill">
            {totalHits === 0
              ? `No entries match "${globalQuery.trim()}".`
              : "Select a search result on the left to inspect its details."}
          </div>
        );
      }
      if (mechHit) {
        return (
          <CodexMechanicsDetail
            article={mechHit.article}
            onSelectTopic={(id) => handleOpenMechanicsTopic(id, null)}
          />
        );
      }
      if (!hit) return null;
      if (hit.kind === "lore" && hit.lore) {
        const lore = hit.lore;
        return (
          <CodexLoreEditor
            lore={lore}
            pendingTagDraft={pendingWorldLoreTagDrafts[lore.id] || ""}
            isCampaignMode={!canEditWorldLore}
            titleInputRef={titleInputRef}
            reclassifiedNotice={
              reclassifiedNotice?.loreId === lore.id ? reclassifiedNotice : null
            }
            artifactUnlinkNotice={artifactUnlinkNotice}
            onDismissMoveNotice={() => setReclassifiedNotice(null)}
            onUndoCategoryMove={(prevCat) => handleCategoryChange(lore, prevCat)}
            onTitleFocus={() =>
              setFrozenOrderIds(globalSearchHits.map((h) => h.id))
            }
            onTitleBlur={() => setFrozenOrderIds(null)}
            onChangeTitle={(val) => handleUpdateLore(lore.id, { title: val })}
            onChangeCategory={(cat) => handleCategoryChange(lore, cat)}
            onDraftTagsChange={(draft) =>
              onUpdatePendingTagDrafts((prev) => ({ ...prev, [lore.id]: draft }))
            }
            onChangeTags={(tags) =>
              handleUpdateLore(lore.id, { entity_tags: tags })
            }
            onChangeContent={(val) => handleUpdateLore(lore.id, { content: val })}
            onDuplicate={() => handleDuplicateLore(lore)}
            onDelete={() => handleDeleteLore(lore)}
          />
        );
      }
      if (hit.kind === "location" && hit.location) {
        return (
          <CodexLocationDetail
            kind="location"
            location={hit.location}
            containers={containers}
            locations={locations}
            visitedContainerIds={visitedContainerIds}
            activeLocationId={activeLocationId}
            isCampaignMode={isCampaignMode}
            unlockLore={unlockLore}
            revealedLoreIds={revealedLoreIds}
            isMutatingLocked={isMutatingLocked}
            onSaveCampaignLocationLore={onSaveCampaignLocationLore}
            onSaveCampaignContainerLore={onSaveCampaignContainerLore}
            onToggleLoreReveal={onToggleLoreReveal}
            onOpenOnMap={onOpenOnMap}
            onEnlargeImage={(url, label, videoUrl, videoMimeType) =>
              setLightboxImage({ url, label, videoUrl, videoMimeType })
            }
          />
        );
      }
      if (hit.kind === "container" && hit.container) {
        return (
          <CodexLocationDetail
            kind="container"
            container={hit.container}
            containers={containers}
            locations={locations}
            visitedContainerIds={visitedContainerIds}
            activeLocationId={activeLocationId}
            isCampaignMode={isCampaignMode}
            unlockLore={unlockLore}
            revealedLoreIds={revealedLoreIds}
            isMutatingLocked={isMutatingLocked}
            onSaveCampaignLocationLore={onSaveCampaignLocationLore}
            onSaveCampaignContainerLore={onSaveCampaignContainerLore}
            onToggleLoreReveal={onToggleLoreReveal}
            onOpenOnMap={onOpenOnMap}
            onEnlargeImage={(url, label, videoUrl, videoMimeType) =>
              setLightboxImage({ url, label, videoUrl, videoMimeType })
            }
          />
        );
      }
      if (hit.kind === "persona" && hit.persona) {
        return (
          <CodexCharacterDetail
            kind="persona"
            persona={hit.persona}
            personaTurnState={effectivePersonaTurnState}
            loreNodes={loreNodes}
            onJumpToLore={handleJumpToLoreId}
            isMutatingLocked={isMutatingLocked}
            onOverridePlayerPhysicalState={onOverridePlayerPhysicalState}
            onOpenMechanicsHelp={(topicId, returnTarget) =>
              handleOpenMechanicsTopic(topicId, returnTarget ?? null)
            }
          />
        );
      }
      if (hit.kind === "character" && hit.characterEntry) {
        return (
          <CodexCharacterDetail
            kind="character"
            persona={activePersona}
            characterEntry={hit.characterEntry}
            loreNodes={loreNodes}
            onJumpToLore={handleJumpToLoreId}
            initialSubtab="bio"
            locations={locations}
            activeWorldName={activeWorldName}
            characterNameMap={resolvedCharacterNameMap}
            activeBranchTurns={activeBranchTurns}
            isMutatingLocked={isMutatingLocked}
            onItemAction={onItemAction}
            onSaveMemories={onSaveMemories}
            onRelocateCharacter={onRelocateCharacter}
            onOverrideCharacterPhysicalState={onOverrideCharacterPhysicalState}
            onOverridePlayerPhysicalState={onOverridePlayerPhysicalState}
            onOpenMechanicsHelp={(topicId, returnTarget) =>
              handleOpenMechanicsTopic(topicId, returnTarget ?? null)
            }
          />
        );
      }
      return null;
    }

    if (activeSection && isEditableCodexSection(activeSection)) {
      const selectedLore = editableLoreItems.find(
        (item) => item.lore.id === selectedEntryKey
      )?.lore;

      if (!selectedLore) {
        const meta = getCodexSectionMeta(activeSection);
        return (
          <div className="ui-empty-state ui-empty-state--fill">
            {artifactUnlinkNotice && (
              <div className="codex-inline-notice codex-inline-notice--amber" style={{ marginBottom: 8 }}>
                <Info size={13} color="var(--accent-amber)" />
                <span>{artifactUnlinkNotice}</span>
              </div>
            )}
            <BookOpen size={24} color={meta.accentColor} />
            <strong>{meta.label}</strong>
            <p>{meta.description}</p>
            {canEditWorldLore && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => handleAddLoreEntry(activeSection)}
              >
                <Plus size={13} /> Create first {meta.label} entry
              </button>
            )}
          </div>
        );
      }

      return (
        <CodexLoreEditor
          lore={selectedLore}
          pendingTagDraft={pendingWorldLoreTagDrafts[selectedLore.id] || ""}
          isCampaignMode={!canEditWorldLore}
          titleInputRef={titleInputRef}
          reclassifiedNotice={
            reclassifiedNotice?.loreId === selectedLore.id
              ? reclassifiedNotice
              : null
          }
          artifactUnlinkNotice={artifactUnlinkNotice}
          onDismissMoveNotice={() => setReclassifiedNotice(null)}
          onUndoCategoryMove={(prevCat) =>
            handleCategoryChange(selectedLore, prevCat)
          }
          onTitleFocus={() =>
            setFrozenOrderIds(editableLoreItems.map((item) => item.lore.id))
          }
          onTitleBlur={() => setFrozenOrderIds(null)}
          onChangeTitle={(val) =>
            handleUpdateLore(selectedLore.id, { title: val })
          }
          onChangeCategory={(cat) => handleCategoryChange(selectedLore, cat)}
          onDraftTagsChange={(draft) =>
            onUpdatePendingTagDrafts((prev) => ({
              ...prev,
              [selectedLore.id]: draft,
            }))
          }
          onChangeTags={(tags) =>
            handleUpdateLore(selectedLore.id, { entity_tags: tags })
          }
          onChangeContent={(val) =>
            handleUpdateLore(selectedLore.id, { content: val })
          }
          onDuplicate={() => handleDuplicateLore(selectedLore)}
          onDelete={() => handleDeleteLore(selectedLore)}
        />
      );
    }

    if (activeSection === "locations") {
      const selectedNode = visibleLocationFlat.find(
        (n) => n.key === selectedEntryKey
      );
      if (!selectedNode) {
        return (
          <div className="ui-empty-state ui-empty-state--fill">
            {categoryQuery.trim()
              ? `No locations or areas match "${categoryQuery.trim()}".`
              : "No locations defined on this world map yet."}
          </div>
        );
      }
      return (
        <CodexLocationDetail
          kind={selectedNode.kind}
          location={selectedNode.location}
          container={selectedNode.container}
          containers={containers}
          locations={locations}
          visitedContainerIds={visitedContainerIds}
          activeLocationId={activeLocationId}
          isCampaignMode={isCampaignMode}
          unlockLore={unlockLore}
          revealedLoreIds={revealedLoreIds}
          isMutatingLocked={isMutatingLocked}
          onSaveCampaignLocationLore={onSaveCampaignLocationLore}
          onSaveCampaignContainerLore={onSaveCampaignContainerLore}
          onToggleLoreReveal={onToggleLoreReveal}
          onOpenOnMap={onOpenOnMap}
          onEnlargeImage={(url, label, videoUrl, videoMimeType) =>
            setLightboxImage({ url, label, videoUrl, videoMimeType })
          }
        />
      );
    }

    if (activeSection === "major_characters") {
      const selectedChar =
        majorCharacterItems.find((m) => m.key === selectedEntryKey) ??
        (selectedEntryKey === null ? majorCharacterItems[0] : undefined);
      if (!selectedChar) {
        return (
          <div className="ui-empty-state ui-empty-state--fill">
            {categoryQuery.trim()
              ? `No persona or characters match "${categoryQuery.trim()}".`
              : "No active persona or campaign characters in this session."}
          </div>
        );
      }
      const isFocusedChar =
        selectedChar.kind === "character" &&
        selectedChar.characterEntry &&
        charFocusTarget?.characterId === selectedChar.characterEntry.record.id;
      return (
        <CodexCharacterDetail
          kind={selectedChar.kind}
          persona={selectedChar.kind === "persona" ? selectedChar.persona : activePersona}
          personaTurnState={effectivePersonaTurnState}
          characterEntry={selectedChar.characterEntry}
          loreNodes={loreNodes}
          onJumpToLore={handleJumpToLoreId}
          initialSubtab={isFocusedChar ? charFocusTarget.subtab : "bio"}
          focusNonce={isFocusedChar ? charFocusTarget.nonce : 0}
          locations={locations}
          activeWorldName={activeWorldName}
          characterNameMap={resolvedCharacterNameMap}
          activeBranchTurns={activeBranchTurns}
          isMutatingLocked={isMutatingLocked}
          onItemAction={onItemAction}
          onSaveMemories={onSaveMemories}
          onRelocateCharacter={onRelocateCharacter}
          onOverrideCharacterPhysicalState={onOverrideCharacterPhysicalState}
          onOverridePlayerPhysicalState={onOverridePlayerPhysicalState}
          onOpenMechanicsHelp={(topicId, returnTarget) =>
            handleOpenMechanicsTopic(topicId, returnTarget ?? null)
          }
        />
      );
    }

    if (activeSection === "mechanics") {
      if (!activeMechanicsArticle) {
        return (
          <div className="ui-empty-state ui-empty-state--fill">
            {categoryQuery.trim()
              ? `No Game Mechanics guides match "${categoryQuery.trim()}".`
              : "Select a Game Mechanics topic on the left."}
          </div>
        );
      }
      return (
        <CodexMechanicsDetail
          article={activeMechanicsArticle}
          onSelectTopic={(id) => handleOpenMechanicsTopic(id)}
        />
      );
    }

    return null;
  };

  const activeSectionMeta = activeSection ? getCodexSectionMeta(activeSection) : null;
  const allLocationContainerIds = useMemo(
    () => collectAllContainerIds(locationTree.roots),
    [locationTree.roots]
  );
  const allMechanicsSubcategoryIds = useMemo(
    () => collectAllMechanicsSubcategoryIds(mechanicsTree.roots),
    [mechanicsTree.roots]
  );
  const totalGlobalSearchCount =
    globalSearchHits.length + globalMechanicsHits.length;

  return (
    <div
      className="codex-root"
      style={{ display: isActive ? "flex" : "none" }}
    >
      {/* Persistent Top Bar (Single Search Input Contract) */}
      <div className="codex-topbar">
        <div className="codex-topbar-left">
          {isTwoPaneMode ? (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleBackToHub}
              >
                <ArrowLeft size={13} /> All Categories
              </button>
              {activeSection === "mechanics" && mechanicsReturnTarget && (
                <button
                  type="button"
                  className="btn btn-sm btn-amber"
                  onClick={handleReturnFromMechanics}
                >
                  <ArrowLeft size={13} /> Return to {mechanicsReturnTarget.label}
                </button>
              )}
            </>
          ) : (
            <span className="codex-topbar-heading">
              <BookOpen size={14} color="var(--accent-violet)" />
              World Codex ({loreNodes.length})
            </span>
          )}
          {isTwoPaneMode && (
            <span className="codex-topbar-crumb">
              {isGlobalSearchMode
                ? `Search Results (${totalGlobalSearchCount})`
                : activeSectionMeta?.label}
            </span>
          )}
        </div>

        <div className="codex-topbar-actions">
          {/* Global Quick Search: mounted ONLY on Hub View & Global Search 2-Pane View */}
          {activeSection === null && (
            <div className="ui-search-wrap ui-search-wrap--codex">
              <Search size={13} className="ui-search-icon" />
              <input
                ref={globalSearchInputRef}
                type="text"
                className="ui-search-input ui-search-input--panel ui-search-input--cyan"
                placeholder="Search Codex titles, keywords, or content..."
                aria-label="Search Codex titles, keywords, or content"
                value={globalQuery}
                onChange={(e) => {
                  setFrozenOrderIds(null);
                  setGlobalQuery(e.target.value);
                }}
                onKeyDown={(e) =>
                  handleSearchInputKeyDown(e, globalQuery, () => setGlobalQuery(""))
                }
              />
              {globalQuery.length > 0 && (
                <button
                  type="button"
                  className="ui-search-clear"
                  aria-label="Clear search"
                  onClick={() => {
                    setFrozenOrderIds(null);
                    setGlobalQuery("");
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {canEditWorldLore &&
            (!activeSection || isEditableCodexSection(activeSection)) && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => handleAddLoreEntry()}
              >
                <Plus size={13} /> Add Entry
              </button>
            )}
        </div>
      </div>

      {/* Hub View */}
      {!isTwoPaneMode ? (
        <>
          <div className="codex-hub-grid">
            {hubSectionData.map(
              ({ sec, countText, invalidCount, preview, disabled }) => (
                <button
                  key={sec.id}
                  type="button"
                  className={`codex-hub-card ${disabled ? "is-disabled" : ""}`}
                  disabled={disabled}
                  aria-disabled={disabled}
                  onClick={() => handleOpenSection(sec.id)}
                  style={
                    {
                      "--codex-card-accent": sec.accentColor,
                    } as React.CSSProperties
                  }
                >
                  <div className="codex-hub-card-head">
                    <div className="codex-hub-card-title-wrap">
                      {SECTION_ICON[sec.id]}
                      <span className="codex-hub-card-title">{sec.label}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {invalidCount > 0 && canEditWorldLore && (
                        <span
                          className="codex-invalid-badge"
                          title={`${invalidCount} incomplete entry/entries`}
                        >
                          !{invalidCount}
                        </span>
                      )}
                      <span className="badge codex-hub-count">{countText}</span>
                    </div>
                  </div>
                  <p className="codex-hub-card-desc">
                    {disabled ? "Available during an active campaign." : sec.description}
                  </p>
                  <div className="codex-hub-card-preview">
                    {disabled ? (
                      <span className="codex-muted-note">Campaign only</span>
                    ) : preview.length === 0 ? (
                      <span className="codex-muted-note">No entries yet</span>
                    ) : (
                      preview.map((title, i) => (
                        <span
                          key={`${sec.id}-prev-${i}`}
                          className={`codex-preview-chip ${
                            title === "Untitled Entry" ? "is-untitled" : ""
                          }`}
                        >
                          {title}
                        </span>
                      ))
                    )}
                  </div>
                </button>
              )
            )}
          </div>

          {/* System Reference Shelf (visibly separated from world canon) */}
          <div className="codex-hub-shelf">
            <button
              type="button"
              className="codex-hub-shelf-main"
              onClick={() => handleOpenSection("mechanics")}
            >
              <div className="codex-hub-shelf-head">
                <div className="codex-hub-card-title-wrap">
                  {SECTION_ICON.mechanics}
                  <span className="codex-hub-card-title">
                    {MECHANICS_SECTION_META.label}
                  </span>
                  <span className="badge codex-badge--location">Reference</span>
                </div>
                <span className="badge codex-hub-count">
                  {MECHANICS_SUBCATEGORIES.length} topics · {MECHANICS_ARTICLES.length} guides
                </span>
              </div>
              <p className="codex-hub-card-desc">
                {MECHANICS_SECTION_META.description}
              </p>
            </button>
            <div className="codex-hub-shelf-chips">
              {MECHANICS_SUBCATEGORIES.map((subcat) => {
                const firstArticle = MECHANICS_ARTICLES.find(
                  (a) => a.subcategoryId === subcat.id
                );
                if (!firstArticle) return null;
                return (
                  <button
                    key={subcat.id}
                    type="button"
                    className="codex-hub-shelf-chip"
                    onClick={() => handleOpenMechanicsTopic(firstArticle.id, null)}
                  >
                    {subcat.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : (
        /* 2-Pane Master-Detail View */
        <div
          className={`codex-two-pane ${
            mobilePane === "detail"
              ? "codex-two-pane--mobile-detail"
              : "codex-two-pane--mobile-list"
          }`}
        >
          {/* Left Navigation Pane */}
          <div className="codex-left-pane">
            {/* Category Switcher Pills */}
            <div className="codex-section-pills" role="tablist">
              {CODEX_SECTIONS.map((sec) => {
                const pillDisabled = sec.campaignOnly && !isCampaignMode;
                if (pillDisabled) return null;
                const isSelected = activeSection === sec.id;
                const inv =
                  canEditWorldLore && isEditableCodexSection(sec.id)
                    ? invalidCountsBySection[sec.id]
                    : 0;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`codex-section-pill ${isSelected ? "active" : ""}`}
                    onClick={() => handleOpenSection(sec.id)}
                  >
                    <span>{sec.label}</span>
                    {inv > 0 && <span className="codex-invalid-dot">!</span>}
                  </button>
                );
              })}
              <span className="codex-pill-divider" aria-hidden="true" />
              <button
                type="button"
                role="tab"
                aria-selected={activeSection === "mechanics"}
                className={`codex-section-pill ${
                  activeSection === "mechanics" ? "active" : ""
                }`}
                onClick={() => handleOpenSection("mechanics")}
              >
                <span>{MECHANICS_SECTION_META.label}</span>
              </button>
            </div>

            {/* Category-Scoped Filter Input (mounted ONLY inside Category 2-Pane View) */}
            {activeSection !== null && (
              <div className="codex-left-filter-row">
                <div className="ui-search-wrap ui-search-wrap--codex" style={{ flex: 1 }}>
                  <Search size={12} className="ui-search-icon" />
                  <input
                    type="text"
                    className="ui-search-input ui-search-input--panel ui-search-input--cyan"
                    placeholder={`Filter ${activeSectionMeta?.label ?? "entries"}...`}
                    aria-label={`Filter ${activeSectionMeta?.label ?? "entries"}`}
                    value={categoryQuery}
                    onChange={(e) => {
                      setFrozenOrderIds(null);
                      setCategoryQuery(e.target.value);
                    }}
                    onKeyDown={(e) =>
                      handleSearchInputKeyDown(e, categoryQuery, () =>
                        setCategoryQuery("")
                      )
                    }
                  />
                  {categoryQuery.length > 0 && (
                    <button
                      type="button"
                      className="ui-search-clear"
                      aria-label="Clear filter"
                      onClick={() => {
                        setFrozenOrderIds(null);
                        setCategoryQuery("");
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ fontSize: "0.68rem", padding: "4px 7px", whiteSpace: "nowrap" }}
                  onClick={() => {
                    const transfer = categoryQuery.trim();
                    setActiveSection(null);
                    setCategoryQuery("");
                    setFrozenOrderIds(null);
                    setMechanicsReturnTarget(null);
                    setGlobalQuery(transfer);
                    if (!transfer) {
                      shouldFocusGlobalSearchRef.current = true;
                    }
                  }}
                  title="Search across all Codex categories"
                >
                  Search all
                </button>
              </div>
            )}

            {/* Locations Expand/Collapse Toolbar */}
            {activeSection === "locations" && allLocationContainerIds.length > 0 && (
              <div className="codex-tree-toolbar">
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  Hierarchy
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="codex-link-btn"
                    onClick={() =>
                      setExpandedContainerIds(new Set(allLocationContainerIds))
                    }
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    className="codex-link-btn"
                    onClick={() => setExpandedContainerIds(new Set())}
                  >
                    Collapse All
                  </button>
                </div>
              </div>
            )}

            {/* Game Mechanics Expand/Collapse Toolbar */}
            {activeSection === "mechanics" && allMechanicsSubcategoryIds.length > 0 && (
              <div className="codex-tree-toolbar">
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                  Topics
                </span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    type="button"
                    className="codex-link-btn"
                    onClick={() =>
                      setExpandedMechanicsSubcats(
                        new Set(allMechanicsSubcategoryIds)
                      )
                    }
                  >
                    Expand All
                  </button>
                  <button
                    type="button"
                    className="codex-link-btn"
                    onClick={() => setExpandedMechanicsSubcats(new Set())}
                  >
                    Collapse All
                  </button>
                </div>
              </div>
            )}

            {/* Scrollable Master List / Tree */}
            <div
              className="codex-list-scroll"
              role="listbox"
              aria-label="Codex entries"
              onKeyDown={handleListKeyDown}
            >
              {isGlobalSearchMode ? (
                totalGlobalSearchCount === 0 ? (
                  <div className="ui-empty-state ui-empty-state--fill">
                    <span>No entries match &ldquo;{globalQuery.trim()}&rdquo;.</span>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setGlobalQuery("")}
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  <>
                    {globalSearchHits.map((hit) => {
                      const isSelected = selectedEntryKey === hit.key;
                      const tierText =
                        hit.matchTier === 1
                          ? "Title"
                          : hit.matchTier === 2
                            ? "Keyword"
                            : "Content";
                      return (
                        <div
                          key={hit.key}
                          role="option"
                          aria-selected={isSelected}
                          tabIndex={0}
                          className={`codex-list-row ${isSelected ? "active" : ""}`}
                          onClick={() =>
                            selectEntryForDetail(hit.key, () =>
                              setCharFocusTarget(null)
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              selectEntryForDetail(hit.key, () =>
                                setCharFocusTarget(null)
                              );
                            }
                          }}
                        >
                          <span
                            className={`codex-list-row-title ${
                              hit.title === "Untitled Entry" ? "is-untitled" : ""
                            }`}
                          >
                            {hit.title}
                          </span>
                          <div className="codex-list-row-meta">
                            {hit.isInvalid && (
                              <span
                                className="codex-invalid-dot"
                                title="Incomplete entry"
                              >
                                !
                              </span>
                            )}
                            <span className={`lore-cat-badge ${hit.badgeClass}`}>
                              {hit.badgeLabel}
                            </span>
                            <span className="codex-match-tier">{tierText}</span>
                          </div>
                        </div>
                      );
                    })}

                    {globalMechanicsHits.length > 0 && (
                      <>
                        <div className="codex-search-group-header">
                          Game Mechanics ({globalMechanicsHits.length})
                        </div>
                        {globalMechanicsHits.map((hit) => {
                          const isSelected = selectedEntryKey === hit.key;
                          const tierText =
                            hit.matchTier === 1
                              ? "Title"
                              : hit.matchTier === 2
                                ? "Keyword"
                                : "Content";
                          return (
                            <div
                              key={hit.key}
                              role="option"
                              aria-selected={isSelected}
                              tabIndex={0}
                              className={`codex-list-row ${isSelected ? "active" : ""}`}
                              onClick={() =>
                                selectEntryForDetail(hit.key, () =>
                                  setCharFocusTarget(null)
                                )
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  selectEntryForDetail(hit.key, () =>
                                    setCharFocusTarget(null)
                                  );
                                }
                              }}
                            >
                              <Compass
                                size={12}
                                color="var(--accent-cyan)"
                                style={{ flexShrink: 0 }}
                              />
                              <span className="codex-list-row-title">
                                {hit.title}
                              </span>
                              <div className="codex-list-row-meta">
                                <span className="badge codex-badge--location">
                                  {hit.badgeLabel}
                                </span>
                                <span className="codex-match-tier">{tierText}</span>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </>
                )
              ) : activeSection && isEditableCodexSection(activeSection) ? (
                editableLoreItems.length === 0 ? (
                  <div className="ui-empty-state ui-empty-state--fill">
                    {categoryQuery.trim() ? (
                      <>
                        <span>
                          No entries match &ldquo;{categoryQuery.trim()}&rdquo;.
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setCategoryQuery("")}
                        >
                          Clear filter
                        </button>
                      </>
                    ) : (
                      <span>No entries in this category yet.</span>
                    )}
                  </div>
                ) : (
                  editableLoreItems.map(({ lore, isInvalid }) => {
                    const isSelected = selectedEntryKey === lore.id;
                    const displayTitle = getLoreDisplayTitle(lore.title);
                    return (
                      <div
                        key={lore.id}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={0}
                        className={`codex-list-row ${isSelected ? "active" : ""}`}
                        onClick={() =>
                          selectEntryForDetail(lore.id, () =>
                            setFrozenOrderIds(null)
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectEntryForDetail(lore.id, () =>
                              setFrozenOrderIds(null)
                            );
                          }
                        }}
                      >
                        <span
                          className={`codex-list-row-title ${
                            !lore.title.trim() ? "is-untitled" : ""
                          }`}
                        >
                          {displayTitle}
                        </span>
                        <div className="codex-list-row-meta">
                          {isInvalid && canEditWorldLore && (
                            <span
                              className="codex-invalid-dot"
                              title="Missing title, content, or keywords"
                            >
                              !
                            </span>
                          )}
                          <span className={`lore-cat-badge lore-cat-badge--${lore.category}`}>
                            {getLoreCategoryLabel(lore.category)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )
              ) : activeSection === "locations" ? (
                locationTree.roots.length === 0 ? (
                  <div className="ui-empty-state ui-empty-state--fill">
                    {categoryQuery.trim() ? (
                      <>
                        <span>
                          No locations match &ldquo;{categoryQuery.trim()}&rdquo;.
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setCategoryQuery("")}
                        >
                          Clear filter
                        </button>
                      </>
                    ) : (
                      <span>No locations mapped yet.</span>
                    )}
                  </div>
                ) : (
                  locationTree.roots.map((node) => renderLocationTreeNode(node, 0))
                )
              ) : activeSection === "major_characters" ? (
                majorCharacterItems.length === 0 ? (
                  <div className="ui-empty-state ui-empty-state--fill">
                    {categoryQuery.trim() ? (
                      <>
                        <span>
                          No cast members match &ldquo;{categoryQuery.trim()}&rdquo;.
                        </span>
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => setCategoryQuery("")}
                        >
                          Clear filter
                        </button>
                      </>
                    ) : (
                      <span>No active persona or campaign characters.</span>
                    )}
                  </div>
                ) : (
                  majorCharacterItems.map((item) => {
                    const isSelected = selectedEntryKey === item.key;
                    return (
                      <div
                        key={item.key}
                        role="option"
                        aria-selected={isSelected}
                        tabIndex={0}
                        className={`codex-list-row ${isSelected ? "active" : ""}`}
                        onClick={() =>
                          selectEntryForDetail(item.key, () =>
                            setCharFocusTarget(null)
                          )
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectEntryForDetail(item.key, () =>
                              setCharFocusTarget(null)
                            );
                          }
                        }}
                      >
                        {item.kind === "persona" ? (
                          <UserCheck
                            size={12}
                            color="var(--accent-emerald)"
                            style={{ flexShrink: 0 }}
                          />
                        ) : (
                          <User
                            size={12}
                            color="var(--accent-cyan)"
                            style={{ flexShrink: 0 }}
                          />
                        )}
                        <span className="codex-list-row-title">{item.title}</span>
                        <div className="codex-list-row-meta">
                          {item.kind === "persona" ? (
                            <span className="badge codex-badge--persona">Persona</span>
                          ) : typeof item.characterEntry?.isPresent === "boolean" ? (
                            <span
                              className={`badge ${
                                item.characterEntry.isPresent
                                  ? "codex-badge--emerald"
                                  : "codex-badge--violet"
                              }`}
                            >
                              {item.characterEntry.isPresent ? "Present" : "Elsewhere"}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )
              ) : activeSection === "mechanics" ? (
                renderMechanicsTreeContent()
              ) : null}
            </div>

            {artifactUnlinkNotice && activeSection !== null && !isEditableCodexSection(activeSection) && (
              <div className="codex-inline-notice" style={{ marginTop: 6 }}>
                <Info size={12} />
                <span>{artifactUnlinkNotice}</span>
              </div>
            )}
          </div>

          {/* Right Detail Pane */}
          <div className="codex-right-pane">
            <div className="codex-mobile-detail-bar">
              <button
                type="button"
                className="btn btn-sm codex-mobile-back-btn"
                onClick={() => {
                  setMobileTopicsSheetOpen(false);
                  setMobilePane("list");
                }}
              >
                <ArrowLeft size={13} aria-hidden="true" />
                <span>
                  {isGlobalSearchMode
                    ? "Results"
                    : activeSection === "mechanics"
                    ? "Topics"
                    : activeSectionMeta?.label ?? "Entries"}
                </span>
              </button>

              {activeSection === "mechanics" && (
                <button
                  type="button"
                  className="btn btn-sm codex-mobile-topic-picker-btn"
                  aria-expanded={mobileTopicsSheetOpen}
                  aria-haspopup="dialog"
                  onClick={() => setMobileTopicsSheetOpen(true)}
                >
                  <Compass
                    size={13}
                    color="var(--accent-cyan)"
                    aria-hidden="true"
                  />
                  <span className="codex-mobile-topic-picker-label">
                    {activeMechanicsArticle
                      ? activeMechanicsArticle.shortTitle ??
                        activeMechanicsArticle.title
                      : "Browse Topics"}
                  </span>
                  <ChevronDown size={12} aria-hidden="true" />
                </button>
              )}
            </div>

            {renderRightPane()}
          </div>
        </div>
      )}

      {mobileTopicsSheetOpen && activeSection === "mechanics" && (
        <div
          className="codex-mobile-topics-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Game Mechanics Topics"
          onClick={() => setMobileTopicsSheetOpen(false)}
        >
          <div
            className="codex-mobile-topics-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="codex-mobile-topics-header">
              <span className="codex-mobile-topics-title">
                <Compass
                  size={14}
                  color="var(--accent-cyan)"
                  aria-hidden="true"
                />
                <span>Game Mechanics Topics</span>
              </span>
              <button
                type="button"
                className="btn btn-sm"
                aria-label="Close topics"
                onClick={() => setMobileTopicsSheetOpen(false)}
              >
                <X size={14} />
              </button>
            </div>

            <div className="codex-mobile-topics-search">
              <div className="ui-search-wrap" style={{ flex: 1 }}>
                <Search size={12} className="ui-search-icon" />
                <input
                  type="text"
                  className="ui-search-input ui-search-input--panel ui-search-input--cyan"
                  placeholder="Filter Game Mechanics..."
                  aria-label="Filter Game Mechanics topics"
                  value={categoryQuery}
                  onChange={(e) => setCategoryQuery(e.target.value)}
                  onKeyDown={(e) =>
                    handleSearchInputKeyDown(e, categoryQuery, () =>
                      setCategoryQuery("")
                    )
                  }
                />
                {categoryQuery.length > 0 && (
                  <button
                    type="button"
                    className="ui-search-clear"
                    aria-label="Clear filter"
                    onClick={() => setCategoryQuery("")}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            <div
              className="codex-list-scroll codex-mobile-topics-list"
              role="listbox"
              aria-label="Game Mechanics topic list"
            >
              {renderMechanicsTreeContent()}
            </div>
          </div>
        </div>
      )}

      {lightboxImage && (
        <ImageLightboxModal
          url={lightboxImage.url}
          label={lightboxImage.label}
          videoUrl={lightboxImage.videoUrl}
          videoMimeType={lightboxImage.videoMimeType}
          autoPlayVideo={isCampaignMode}
          onClose={() => setLightboxImage(null)}
        />
      )}
    </div>
  );
};
