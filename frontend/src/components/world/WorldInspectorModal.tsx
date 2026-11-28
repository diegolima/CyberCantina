import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  ArrowUpCircle,
  BookOpen,
  Check,
  Compass,
  Globe,
  Image as ImageIcon,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { api } from "../../api";
import { useModalDialog } from "../../hooks/useModalDialog";
import { useOverlayBackHandler } from "../../hooks/useOverlayBackHandler";
import {
  LOCATION_LORE_CATEGORIES,
  WORLD_LORE_CATEGORIES,
} from "../../types";
import type {
  AppSettings,
  CampaignWorldSettings,
  CharacterObjectiveOverridePayload,
  CodexReturnTarget,
  ItemEquipActionPayload,
  LocationContainer,
  LocationEdge,
  LocationLoreCategory,
  LocationLoreNodeDraft,
  LocationNode,
  LocationProp,
  LoreNode,
  MechanicsTopicId,
  MemoryShard,
  PersonaRecord,
  PersonaTurnStateSnapshot,
  PhysicalStateOverridePayload,
  TurnNodeRecord,
  WorldGlobalRules,
  WorldLoreCategory,
  WorldLoreNodeDraft,
  WorldMediaItem,
  WorldRecord,
} from "../../types";
import {
  DEPRECATED_WORLD_KEYS,
  appendLegacyText,
  buildWorldUnsupportedFieldsState,
  filterRemainingUnsupportedFields,
} from "../../utils/unsupportedFields";
import { SpatialTopologyView } from "../SpatialTopologyView";
import { normalizeTagList } from "../TagChipsInput";
import {
  computeUnreachableLocationIds,
  validateContainersState,
} from "../map/mapValidation";
import { ClickToEditField } from "../shared/ClickToEditField";
import { MechanicsHelpButton } from "../shared/MechanicsHelpButton";
import { SplitSaveButton } from "../shared/SplitSaveButton";
import { UnsupportedFieldsTab } from "../shared/UnsupportedFieldsTab";
import {
  type CodexCampaignCharacterEntry,
  isWorldLoreEntryValid,
} from "./codexHelpers";
import { type CodexFocusRequest, WorldCodexTab } from "./WorldCodexTab";
import { mapDraftToNodesAndEdges } from "./worldDraftMappers";
import { WorldMediaTab } from "./WorldMediaTab";

interface WorldInspectorModalProps {
  world: WorldRecord;
  onClose: () => void;
  onSaved: (updated: WorldRecord, closeModal?: boolean) => void;
  mode?: "inspector" | "wizard" | "campaign";
  initialTab?: WorldTab | "lore";
  campaignWorldSettings?: CampaignWorldSettings;
  onSaveCampaignWorldSettings?: (
    settings: CampaignWorldSettings
  ) => Promise<void> | void;
  onSaveCampaignWorldLore?: (
    loreNodes: WorldLoreNodeDraft[]
  ) => Promise<void> | void;
  onSaveCampaignLocationLore?: (
    locationId: string,
    drafts: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onSaveCampaignContainerLore?: (
    containerId: string,
    drafts: LocationLoreNodeDraft[]
  ) => Promise<void> | void;
  onToggleCampaignLoreReveal?: (
    loreId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onToggleCampaignEdgeReveal?: (
    edgeId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onSaveCampaignLocationProps?: (
    locationId: string,
    props: LocationProp[]
  ) => Promise<void> | void;
  onToggleCampaignPropReveal?: (
    propId: string,
    revealed: boolean
  ) => Promise<void> | void;
  onTransferCampaignProp?: (
    propId: string,
    holderId: string
  ) => Promise<void> | void;
  onSaveCampaignMap?: (payload: {
    containers: LocationContainer[];
    locations: LocationNode[];
    edges: LocationEdge[];
  }) => Promise<void> | void;
  revealedLoreIds?: readonly string[];
  revealedEdgeIds?: readonly string[];
  revealedPropIds?: readonly string[];
  isMutatingLocked?: boolean;
  onBackToSeed?: () => void;
  onCommitDraft?: (payload: {
    name: string;
    global_rules: WorldGlobalRules;
    containers: LocationContainer[];
    locations: LocationNode[];
    edges: LocationEdge[];
    lore_nodes: LoreNode[];
  }) => Promise<WorldRecord>;
  activePersona?: PersonaRecord | null;
  activePersonaTurnState?: PersonaTurnStateSnapshot | null;
  campaignId?: string;
  campaignCharacters?: CodexCampaignCharacterEntry[];
  activeLocationId?: string;
  visitedContainerIds?: string[];
  appSettings?: AppSettings | null;
  isAdmin?: boolean;
  activeBranchTurns?: readonly TurnNodeRecord[];
  initialCodexFocus?: CodexFocusRequest | null;
  onToggleItemEquip?: (payload: ItemEquipActionPayload) => Promise<void> | void;
  onUpdateCampaignMemories?: (
    characterId: string,
    shards: MemoryShard[]
  ) => Promise<void>;
  onOverrideCharacterLocation?: (
    characterId: string,
    locationId: string
  ) => Promise<void> | void;
  onOverrideCharacterPhysicalState?: (
    characterId: string,
    payload: PhysicalStateOverridePayload
  ) => Promise<void> | void;
  onOverrideCharacterObjective?: (
    characterId: string,
    payload: CharacterObjectiveOverridePayload
  ) => Promise<void> | void;
  onOverridePlayerPhysicalState?: (
    payload: PhysicalStateOverridePayload
  ) => Promise<void> | void;
  onRequestSeedUpdate?: (world: WorldRecord) => void;
}

export type WorldTab = "base" | "media" | "map" | "codex" | "settings" | "unsupported";

export const WorldInspectorModal: React.FC<WorldInspectorModalProps> = ({
  world,
  onClose,
  onSaved,
  mode = "inspector",
  initialTab = "base",
  campaignWorldSettings,
  onSaveCampaignWorldSettings,
  onSaveCampaignWorldLore,
  onSaveCampaignLocationLore,
  onSaveCampaignContainerLore,
  onToggleCampaignLoreReveal,
  onToggleCampaignEdgeReveal,
  onSaveCampaignLocationProps,
  onToggleCampaignPropReveal,
  onTransferCampaignProp,
  onSaveCampaignMap,
  revealedLoreIds = [],
  revealedEdgeIds = [],
  revealedPropIds = [],
  isMutatingLocked = false,
  onBackToSeed,
  onCommitDraft,
  activePersona,
  activePersonaTurnState,
  campaignId,
  campaignCharacters = [],
  activeLocationId,
  visitedContainerIds = [],
  appSettings = null,
  isAdmin = false,
  activeBranchTurns = [],
  initialCodexFocus = null,
  onToggleItemEquip,
  onUpdateCampaignMemories,
  onOverrideCharacterLocation,
  onOverrideCharacterPhysicalState,
  onOverrideCharacterObjective,
  onOverridePlayerPhysicalState,
  onRequestSeedUpdate,
}) => {
  const isCampaignMode = mode === "campaign";
  const [activeTab, setActiveTab] = useState<WorldTab>(() =>
    initialTab === "lore" ? "codex" : initialTab
  );
  const [name, setName] = useState(world.name);
  const [globalRules, setGlobalRules] = useState<WorldGlobalRules>({
    describe_on_first_visit: true,
    auto_spawn_props_on_search_crit: false,
    ...world.global_rules,
  });
  const [campaignDescribeFirstVisit, setCampaignDescribeFirstVisit] = useState<boolean>(
    campaignWorldSettings?.describe_on_first_visit ??
      world.global_rules.describe_on_first_visit ??
      true
  );
  const [campaignAutoSpawnOnSearchCrit, setCampaignAutoSpawnOnSearchCrit] =
    useState<boolean>(
      campaignWorldSettings?.auto_spawn_props_on_search_crit ??
        world.global_rules.auto_spawn_props_on_search_crit ??
        false
    );
  const [campaignUnlockLore, setCampaignUnlockLore] = useState<boolean>(
    Boolean(campaignWorldSettings?.unlock_lore)
  );
  const [savingGmToggle, setSavingGmToggle] = useState(false);
  const [campaignWorldLoreDirty, setCampaignWorldLoreDirty] = useState(false);

  useEffect(() => {
    if (isCampaignMode) {
      setCampaignUnlockLore(Boolean(campaignWorldSettings?.unlock_lore));
      if (campaignWorldSettings?.auto_spawn_props_on_search_crit !== undefined) {
        setCampaignAutoSpawnOnSearchCrit(
          Boolean(campaignWorldSettings.auto_spawn_props_on_search_crit)
        );
      }
    }
  }, [
    isCampaignMode,
    campaignWorldSettings?.unlock_lore,
    campaignWorldSettings?.auto_spawn_props_on_search_crit,
  ]);

  useEffect(() => {
    if (isCampaignMode && !campaignWorldLoreDirty) {
      setLoreNodes(
        world.lore_nodes.map((lore) => ({
          ...lore,
          category: WORLD_LORE_CATEGORIES.includes(
            lore.category as WorldLoreCategory
          )
            ? (lore.category as WorldLoreCategory)
            : "faction",
          entity_tags: [...lore.entity_tags],
        }))
      );
    }
  }, [isCampaignMode, world.lore_nodes, campaignWorldLoreDirty]);
  const [containers, setContainers] = useState<LocationContainer[]>(
    (world.containers ?? []).map((cont) => ({
      ...cont,
      environmental_tags: [...(cont.environmental_tags ?? [])],
      lore_nodes: (cont.lore_nodes ?? []).map((ln) => ({
        ...ln,
        entity_tags: [...(ln.entity_tags ?? [])],
      })),
    }))
  );
  const [locations, setLocations] = useState<LocationNode[]>(
    world.locations
      .filter((loc) => !loc.created_at_turn_id)
      .map((loc) => ({
        ...loc,
        environmental_tags: [...loc.environmental_tags],
        lore_nodes: (loc.lore_nodes ?? []).map((ln) => ({
          ...ln,
          entity_tags: [...(ln.entity_tags ?? [])],
        })),
        props: (loc.props ?? []).map((prop) => ({
          ...prop,
          flags: [...(prop.flags ?? [])],
        })),
      }))
  );
  const [edges, setEdges] = useState<LocationEdge[]>(
    world.edges
      .filter((edge) => !edge.created_at_turn_id)
      .map((edge) => ({ ...edge }))
  );
  const [loreNodes, setLoreNodes] = useState<LoreNode[]>(
    world.lore_nodes.map((lore) => ({
      ...lore,
      category: WORLD_LORE_CATEGORIES.includes(
        lore.category as WorldLoreCategory
      )
        ? (lore.category as WorldLoreCategory)
        : "faction",
      entity_tags: [...lore.entity_tags],
    }))
  );
  const [pendingWorldLoreTagDrafts, setPendingWorldLoreTagDrafts] = useState<
    Record<string, string>
  >({});

  const [activeWorldId, setActiveWorldId] = useState(world.id);
  const [media, setMedia] = useState<WorldMediaItem[]>(() => [...(world.media ?? [])]);
  const [isDirty, setIsDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingWorld, setExportingWorld] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportIncludeChars, setExportIncludeChars] = useState(true);
  const [exportIncludeMedia, setExportIncludeMedia] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const focusNonceRef = useRef(0);
  const [codexFocusRequest, setCodexFocusRequest] =
    useState<CodexFocusRequest | null>(() => initialCodexFocus ?? null);

  useEffect(() => {
    if (!initialCodexFocus) return;
    setCodexFocusRequest(initialCodexFocus);
    setActiveTab("codex");
  }, [initialCodexFocus]);

  const handleOpenInternalMechanicsHelp = (
    topicId: MechanicsTopicId,
    returnTarget: CodexReturnTarget
  ) => {
    setCodexFocusRequest({
      kind: "mechanics",
      topicId,
      returnTarget,
      nonce: ++focusNonceRef.current,
    });
    setActiveTab("codex");
  };

  const characterNameMap = useMemo(
    () =>
      Object.fromEntries(
        campaignCharacters.map((c) => [c.record.id, c.record.name])
      ),
    [campaignCharacters]
  );
  const [externalMapFocus, setExternalMapFocus] = useState<{
    kind: "location" | "container";
    id: string;
    nonce: number;
  } | null>(null);

  const effectiveContainers = isCampaignMode
    ? world.containers ?? []
    : containers;
  const effectiveLocations = isCampaignMode ? world.locations : locations;
  const effectiveEdges = isCampaignMode ? world.edges : edges;
  const effectiveLoreNodes =
    isCampaignMode && !campaignUnlockLore ? world.lore_nodes : loreNodes;

  const unsupportedFields = useMemo(
    () => buildWorldUnsupportedFieldsState(world),
    [world]
  );
  const unsupportedKeysCount = Object.keys(unsupportedFields).length;
  const [stagedUnsupportedDeletes, setStagedUnsupportedDeletes] = useState<Set<string>>(
    () => new Set()
  );

  const handleStageUnsupportedDelete = (key: string) => {
    if (isCampaignMode) return;
    setStagedUnsupportedDeletes((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    markDirty();
  };

  const handleUndoUnsupportedDelete = (key: string) => {
    if (isCampaignMode) return;
    setStagedUnsupportedDeletes((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    markDirty();
  };

  const handleMigrateWorldRuleText = (
    key: string,
    targetField: "tone" | "tech_or_magic_rules",
    text: string,
    deleteAfter: boolean
  ) => {
    if (isCampaignMode) return;
    setGlobalRules((prev) => ({
      ...prev,
      [targetField]: appendLegacyText(prev[targetField] || "", text),
    }));
    if (deleteAfter) {
      setStagedUnsupportedDeletes((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }
    markDirty();
  };

  const handleExportWorld = async () => {
    setExportingWorld(true);
    try {
      await api.exportWorld(activeWorldId, exportIncludeChars, exportIncludeMedia);
      setShowExportDialog(false);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setExportingWorld(false);
    }
  };

  const handleWorldMediaMutated = (
    updated: WorldRecord,
    deletedMediaId?: string
  ) => {
    setActiveWorldId(updated.id);
    setMedia([...(updated.media ?? [])]);
    if (deletedMediaId || updated.id !== activeWorldId) {
      setContainers((prev) =>
        prev.map((c) => {
          const cleared = deletedMediaId && c.image_media_id === deletedMediaId;
          return {
            ...c,
            world_id: updated.id,
            image_media_id: cleared ? null : c.image_media_id,
            image_url: cleared ? null : c.image_url,
            image_label: cleared ? null : c.image_label,
          };
        })
      );
      setLocations((prev) =>
        prev.map((l) => {
          const cleared = deletedMediaId && l.image_media_id === deletedMediaId;
          return {
            ...l,
            world_id: updated.id,
            image_media_id: cleared ? null : l.image_media_id,
            image_url: cleared ? null : l.image_url,
            image_label: cleared ? null : l.image_label,
          };
        })
      );
      setEdges((prev) => prev.map((e) => ({ ...e, world_id: updated.id })));
      setLoreNodes((prev) => prev.map((ln) => ({ ...ln, world_id: updated.id })));
    }
    onSaved(updated, false);
  };

  // Re-imagine Map Modal state
  const [showReimagineModal, setShowReimagineModal] = useState(false);
  const [reimagineDescription, setReimagineDescription] = useState("");
  const [reimagineCount, setReimagineCount] = useState(
    Math.max(3, Math.min(8, locations.length || 4))
  );
  const [reimagining, setReimagining] = useState(false);
  const [reimagineError, setReimagineError] = useState<string | null>(null);

  const effectiveIsDirty =
    mode === "wizard"
      ? true
      : isCampaignMode
      ? isDirty || campaignWorldLoreDirty
      : isDirty;

  const { requestClose } = useOverlayBackHandler({
    id:
      mode === "wizard"
        ? "world-wizard-draft"
        : isCampaignMode
        ? "campaign-world-sheet"
        : "world-inspector",
    isOpen: true,
    isDirty: effectiveIsDirty,
    onClose,
    guard: {
      title:
        mode === "wizard"
          ? "Discard unsaved world draft?"
          : "Discard unsaved world changes?",
      message:
        mode === "wizard"
          ? "You have an unsaved world draft. Discard it and return?"
          : "You have unsaved edits to this world. Discard them and close?",
      confirmLabel: "Discard",
      cancelLabel: "Stay",
    },
  });

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useModalDialog({
    isOpen: true,
    onClose: requestClose,
    disableEscape: showExportDialog || showReimagineModal || saving,
    dialogRef,
  });

  useOverlayBackHandler({
    id: "world-export-dialog",
    isOpen: showExportDialog,
    priority: 15,
    onClose: () => {
      if (!exportingWorld) {
        setShowExportDialog(false);
      }
    },
  });

  useOverlayBackHandler({
    id: "world-reimagine-modal",
    isOpen: showReimagineModal,
    priority: 15,
    onClose: () => {
      if (!reimagining) {
        setShowReimagineModal(false);
      }
    },
  });

  const handleExecuteReimagine = async () => {
    if (!reimagineDescription.trim()) return;
    setReimagining(true);
    setReimagineError(null);
    try {
      const mapDraft = await api.reimagineWorldMap({
        world_name: name,
        global_rules: globalRules,
        map_description: reimagineDescription.trim(),
        location_count: reimagineCount,
      });
      const { locations: newLocs, edges: newEdges } = mapDraftToNodesAndEdges(
        mapDraft,
        world.id
      );
      setLocations(newLocs);
      setEdges(newEdges);
      markDirty();
      setShowReimagineModal(false);
      setReimagineDescription("");
    } catch (err) {
      setReimagineError(String(err));
    } finally {
      setReimagining(false);
    }
  };

  const markDirty = () => {
    if (!isDirty) setIsDirty(true);
    if (justSaved) setJustSaved(false);
  };

  const reachabilityReport = computeUnreachableLocationIds(locations, edges);
  const containerValidationErrors = validateContainersState(containers, locations);
  const mapHasBlockingErrors =
    Boolean(reachabilityReport.starterError) ||
    reachabilityReport.unreachableIds.length > 0 ||
    containerValidationErrors.length > 0;

  const invalidWorldLoreCount = effectiveLoreNodes.filter(
    (lore) => !isWorldLoreEntryValid(lore, pendingWorldLoreTagDrafts[lore.id])
  ).length;

  const invalidLocationLoreCount = effectiveLocations.reduce((acc, loc) => {
    const locInvalid = (loc.lore_nodes ?? []).filter(
      (ln) =>
        !ln.title.trim() ||
        !ln.content.trim() ||
        !LOCATION_LORE_CATEGORIES.includes(
          ln.category as LocationLoreCategory
        ) ||
        !ln.entity_tags ||
        ln.entity_tags.length === 0
    ).length;
    return acc + locInvalid;
  }, 0);

  const locationsWithLoreCount = effectiveLocations.reduce(
    (acc, loc) => acc + (loc.lore_nodes?.length ?? 0),
    0
  );

  const syncStateFromSavedWorld = (updated: WorldRecord) => {
    setActiveWorldId(updated.id);
    setName(updated.name);
    setGlobalRules({
      describe_on_first_visit: true,
      auto_spawn_props_on_search_crit: false,
      ...updated.global_rules,
    });
    setContainers(
      (updated.containers ?? []).map((cont) => ({
        ...cont,
        environmental_tags: [...(cont.environmental_tags ?? [])],
        lore_nodes: (cont.lore_nodes ?? []).map((ln) => ({
          ...ln,
          entity_tags: [...(ln.entity_tags ?? [])],
        })),
      }))
    );
    setLocations(
      updated.locations
        .filter((loc) => !loc.created_at_turn_id)
        .map((loc) => ({
          ...loc,
          environmental_tags: [...loc.environmental_tags],
          lore_nodes: (loc.lore_nodes ?? []).map((ln) => ({
            ...ln,
            entity_tags: [...(ln.entity_tags ?? [])],
          })),
          props: (loc.props ?? []).map((prop) => ({
            ...prop,
            flags: [...(prop.flags ?? [])],
          })),
        }))
    );
    setEdges(
      updated.edges
        .filter((edge) => !edge.created_at_turn_id)
        .map((edge) => ({ ...edge }))
    );
    setLoreNodes(
      updated.lore_nodes.map((lore) => ({
        ...lore,
        category: WORLD_LORE_CATEGORIES.includes(
          lore.category as WorldLoreCategory
        )
          ? (lore.category as WorldLoreCategory)
          : "faction",
        entity_tags: [...lore.entity_tags],
      }))
    );
    setMedia([...(updated.media ?? [])]);
    setPendingWorldLoreTagDrafts({});
    setStagedUnsupportedDeletes(new Set());
    setIsDirty(false);
    setJustSaved(true);
  };

  const handleSave = async (options?: {
    closeAfter?: boolean;
  }): Promise<boolean> => {
    const closeAfter =
      options?.closeAfter ?? (mode === "wizard");
    if (isCampaignMode) {
      let flushedCampaignLore: WorldLoreNodeDraft[] | null = null;
      if (campaignUnlockLore && campaignWorldLoreDirty && onSaveCampaignWorldLore) {
        const flushed = loreNodes.map((lore) => {
          const pendingRaw = pendingWorldLoreTagDrafts[lore.id] || "";
          const pendingParts = pendingRaw
            .split(/[,;\n]+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const effectiveTags = normalizeTagList(
            lore.entity_tags || [],
            pendingParts
          );
          return {
            id: lore.id.startsWith("new_lore_") ? null : lore.id,
            title: lore.title.trim(),
            content: lore.content.trim(),
            category: WORLD_LORE_CATEGORIES.includes(
              lore.category as WorldLoreCategory
            )
              ? (lore.category as WorldLoreCategory)
              : "faction",
            entity_tags: effectiveTags,
          };
        });
        for (let i = 0; i < flushed.length; i++) {
          const item = flushed[i];
          if (!item.title || !item.content || item.entity_tags.length === 0) {
            setActiveTab("codex");
            setCodexFocusRequest({
              loreId: loreNodes[i].id,
              nonce: ++focusNonceRef.current,
            });
            setError(
              `Codex entry #${i + 1} ("${item.title || "Untitled"}") requires a title, content, and at least 1 trigger keyword.`
            );
            return false;
          }
        }
        flushedCampaignLore = flushed;
      }

      setSaving(true);
      setError(null);
      try {
        if (onSaveCampaignWorldSettings) {
          await onSaveCampaignWorldSettings({
            describe_on_first_visit: campaignDescribeFirstVisit,
            unlock_lore: campaignUnlockLore,
            auto_spawn_props_on_search_crit: campaignAutoSpawnOnSearchCrit,
          });
        }
        if (flushedCampaignLore !== null && onSaveCampaignWorldLore) {
          await onSaveCampaignWorldLore(flushedCampaignLore);
          setCampaignWorldLoreDirty(false);
          setPendingWorldLoreTagDrafts({});
        }
        setIsDirty(false);
        setJustSaved(true);
        onSaved(world, closeAfter);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setSaving(false);
      }
    }

    if (locations.length === 0) {
      setError("At least one location is required.");
      return false;
    }

    const flushedWorldLore: LoreNode[] = loreNodes.map((lore) => {
      const pendingRaw = pendingWorldLoreTagDrafts[lore.id] || "";
      const pendingParts = pendingRaw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const effectiveTags = normalizeTagList(
        lore.entity_tags || [],
        pendingParts
      );
      return {
        ...lore,
        title: lore.title.trim(),
        content: lore.content.trim(),
        category: WORLD_LORE_CATEGORIES.includes(
          lore.category as WorldLoreCategory
        )
          ? (lore.category as WorldLoreCategory)
          : "faction",
        entity_tags: effectiveTags,
      };
    });

    for (let i = 0; i < flushedWorldLore.length; i++) {
      const item = flushedWorldLore[i];
      if (!item.title || !item.content || item.entity_tags.length === 0) {
        setActiveTab("codex");
        setCodexFocusRequest({
          loreId: item.id,
          nonce: ++focusNonceRef.current,
        });
            setError(
              `Codex entry #${i + 1} ("${
                item.title || "Untitled"
              }") must have a non-empty title, content, and at least 1 trigger keyword.`
            );
            return false;
          }
        }

    const sanitizedLocations: LocationNode[] = locations.map((loc) => ({
      ...loc,
      lore_nodes: (loc.lore_nodes ?? []).map((ln) => ({
        ...ln,
        title: ln.title.trim(),
        content: ln.content.trim(),
        category: LOCATION_LORE_CATEGORIES.includes(
          ln.category as LocationLoreCategory
        )
          ? (ln.category as LocationLoreCategory)
          : "rumor",
        entity_tags: normalizeTagList(ln.entity_tags || [], []),
      })),
      props: (loc.props ?? []).map((prop) => ({
        ...prop,
        name: (prop.name || "").trim(),
        note: (prop.note || "").trim(),
        flags: [...(prop.flags ?? [])],
      })),
    }));

    for (const loc of sanitizedLocations) {
      for (let i = 0; i < (loc.lore_nodes ?? []).length; i++) {
        const ln = loc.lore_nodes![i];
        if (!ln.title || !ln.content || ln.entity_tags.length === 0) {
          setActiveTab("map");
          setError(
            `Location "${loc.name}" Lore entry #${i + 1} ("${
              ln.title || "Untitled"
            }") must have a non-empty title, content, and at least 1 trigger keyword.`
          );
          return false;
        }
      }
      for (let i = 0; i < (loc.props ?? []).length; i++) {
        const prop = loc.props![i];
        if (!prop.name) {
          setActiveTab("map");
          setError(
            `Location "${loc.name}" Prop #${i + 1} must have a non-empty item name.`
          );
          return false;
        }
      }
    }

    const sanitizedContainers: LocationContainer[] = containers.map((cont) => ({
      ...cont,
      name: cont.name.trim(),
      description: cont.description.trim(),
      environmental_tags: normalizeTagList(cont.environmental_tags || [], []),
      lore_nodes:
        cont.depth === 1
          ? (cont.lore_nodes ?? []).map((ln) => ({
              ...ln,
              title: ln.title.trim(),
              content: ln.content.trim(),
              category: LOCATION_LORE_CATEGORIES.includes(
                ln.category as LocationLoreCategory
              )
                ? (ln.category as LocationLoreCategory)
                : "rumor",
              entity_tags: normalizeTagList(ln.entity_tags || [], []),
            }))
          : [],
    }));

    const containerErrors = validateContainersState(
      sanitizedContainers,
      sanitizedLocations
    );
    if (containerErrors.length > 0) {
      setActiveTab("map");
      setError(containerErrors[0]);
      return false;
    }

    const saveReach = computeUnreachableLocationIds(sanitizedLocations, edges);
    if (saveReach.starterError || saveReach.unreachableIds.length > 0) {
      setActiveTab("map");
      setError(
        saveReach.starterError ||
          `${saveReach.unreachableIds.length} unlinked location(s) must be bidirectionally connected to the Starting Location before saving.`
      );
      return false;
    }

    setLoreNodes(flushedWorldLore);
    setContainers(sanitizedContainers);
    setLocations(sanitizedLocations);
    setPendingWorldLoreTagDrafts({});

    setSaving(true);
    setError(null);
    const remainingUnsupported = filterRemainingUnsupportedFields(
      unsupportedFields,
      stagedUnsupportedDeletes
    );
    const payload = {
      name: name.trim() || world.name,
      global_rules: globalRules,
      containers: sanitizedContainers,
      locations: sanitizedLocations,
      edges,
      lore_nodes: flushedWorldLore,
    };
    try {
      const updated =
        mode === "wizard" && onCommitDraft
          ? await onCommitDraft(payload)
          : await api.updateWorld(activeWorldId, {
              ...payload,
              unsupported_fields: remainingUnsupported,
            });
      if (mode === "wizard") {
        setStagedUnsupportedDeletes(new Set());
        onSaved(updated, true);
        return true;
      }
      syncStateFromSavedWorld(updated);
      if (
        activeTab === "unsupported" &&
        Object.keys(updated.unsupported_fields ?? {}).length === 0
      ) {
        setActiveTab("base");
      }
      onSaved(updated, closeAfter);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={mode === "wizard" ? undefined : requestClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="modal-panel modal-panel--sheet-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span id={titleId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Globe size={18} color="var(--accent-cyan)" />
            World Sheet
            {isCampaignMode && campaignUnlockLore && (
              <span
                style={{
                  fontSize: "0.7rem",
                  color: "var(--accent-amber)",
                  background: "rgba(245, 158, 11, 0.14)",
                  border: "1px solid rgba(245, 158, 11, 0.45)",
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontWeight: 600,
                }}
              >
                GM Mode Active
              </span>
            )}
            {mode === "wizard" && (
              <span
                style={{
                  fontSize: "0.72rem",
                  color: "var(--accent-cyan)",
                  background: "rgba(34, 211, 238, 0.1)",
                  border: "1px solid rgba(34, 211, 238, 0.3)",
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontWeight: 500,
                }}
              >
                1.2 Wizard Draft
              </span>
            )}
          </span>
          <button type="button" className="btn" onClick={requestClose} aria-label="Close modal">
            <X size={15} />
          </button>
        </div>

        {!isCampaignMode &&
          mode === "inspector" &&
          world?.seed_update?.update_available &&
          onRequestSeedUpdate && (
            <div
              className={`seed-update-banner ${
                world.seed_update.is_dismissed ? "is-skipped" : "is-cyan"
              }`}
              role="region"
              aria-label="World seed update"
            >
              <div className="seed-update-banner-main">
                <ArrowUpCircle
                  size={15}
                  color={
                    world.seed_update.is_dismissed
                      ? "var(--text-muted)"
                      : "var(--accent-cyan)"
                  }
                />
                {world.seed_update.is_dismissed ? (
                  <span>
                    Built-in seed v{world.seed_update.latest_version} available
                    (skipped)
                  </span>
                ) : (
                  <span>
                    <strong>
                      Update available (v{world.seed_update.current_version} → v
                      {world.seed_update.latest_version})
                    </strong>
                    {world.seed_update.changelog
                      ? ` — ${world.seed_update.changelog}`
                      : ""}
                  </span>
                )}
              </div>
              <button
                type="button"
                className={`btn btn-sm ${
                  world.seed_update.is_dismissed
                    ? ""
                    : "seed-update-cyan-btn"
                }`}
                onClick={() => onRequestSeedUpdate(world)}
              >
                {world.seed_update.is_dismissed ? "Review Update" : "Update"}
              </button>
            </div>
          )}

        <div className="modal-tabs modal-tabs-cyan" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "base"}
            className={`modal-tab-btn ${activeTab === "base" ? "active" : ""}`}
            onClick={() => setActiveTab("base")}
          >
            <Globe size={14} />
            <span>Base</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "media"}
            className={`modal-tab-btn ${activeTab === "media" ? "active" : ""}`}
            onClick={() => setActiveTab("media")}
          >
            <ImageIcon size={14} />
            <span>Media</span>
            <span className="modal-tab-badge">
              {media.filter((m) => m.media_type === "image").length}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "map"}
            className={`modal-tab-btn ${activeTab === "map" ? "active" : ""}`}
            onClick={() => setActiveTab("map")}
          >
            <Compass size={14} />
            <span>Map</span>
            <span className="modal-tab-badge">{effectiveLocations.length}</span>
            {invalidLocationLoreCount > 0 && (
              <span
                className="modal-tab-badge"
                style={{
                  background: "rgba(244, 63, 94, 0.22)",
                  color: "#fda4af",
                  border: "1px solid rgba(244, 63, 94, 0.5)",
                }}
                title={`${invalidLocationLoreCount} incomplete location lore entry/entries`}
              >
                !{invalidLocationLoreCount}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "codex"}
            className={`modal-tab-btn ${activeTab === "codex" ? "active" : ""}`}
            onClick={() => setActiveTab("codex")}
          >
            <BookOpen size={14} />
            <span>Codex</span>
            <span className="modal-tab-badge">{effectiveLoreNodes.length}</span>
            {invalidWorldLoreCount > 0 && (!isCampaignMode || campaignUnlockLore) && (
              <span
                className="modal-tab-badge"
                style={{
                  background: "rgba(244, 63, 94, 0.22)",
                  color: "#fda4af",
                  border: "1px solid rgba(244, 63, 94, 0.5)",
                }}
                title={`${invalidWorldLoreCount} incomplete Codex lore entry/entries`}
              >
                !{invalidWorldLoreCount}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "settings"}
            className={`modal-tab-btn ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <SlidersHorizontal size={14} />
            <span>World Settings</span>
          </button>
          {unsupportedKeysCount > 0 && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "unsupported"}
              className={`modal-tab-btn ${activeTab === "unsupported" ? "active" : ""}`}
              onClick={() => setActiveTab("unsupported")}
            >
              <AlertTriangle size={14} />
              <span>Unsupported</span>
              <span className="modal-tab-badge">
                {Math.max(0, unsupportedKeysCount - stagedUnsupportedDeletes.size)}
              </span>
            </button>
          )}
        </div>

        <div className="modal-body">
          {/* Base Tab */}
          <div
            style={{
              display: activeTab === "base" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: "0.76rem",
                color: "var(--text-secondary)",
                background: "var(--bg-card)",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-subtle)",
              }}
            >
              {mode === "wizard"
                ? "Click on any field below to edit it, or switch to the Map and Codex tabs above to customize locations, passages, and GraphRAG lore before committing your world."
                : isCampaignMode
                ? "Base world identity and rules are pinned to this campaign's snapshot. Adjust campaign behavior in the World Settings tab."
                : "Click on any field below to edit it. Active campaigns running in this world remain pinned to their original world snapshot automatically."}
            </div>

            <div className="world-inspector-base-grid">
              <ClickToEditField
                label="World Name"
                value={name}
                readOnly={isCampaignMode}
                onChange={(val) => {
                  setName(val);
                  markDirty();
                }}
              />
              <ClickToEditField
                label="Genre"
                value={globalRules.genre}
                readOnly={isCampaignMode}
                onChange={(val) => {
                  setGlobalRules({ ...globalRules, genre: val });
                  markDirty();
                }}
              />
              <ClickToEditField
                label="Starting Clock (YYYY-MM-DD HH:MM)"
                value={globalRules.starting_timestamp}
                readOnly={isCampaignMode}
                onChange={(val) => {
                  setGlobalRules({ ...globalRules, starting_timestamp: val });
                  markDirty();
                }}
              />
            </div>

            <ClickToEditField
              label="Narrative Tone & Stylistic Atmosphere"
              value={globalRules.tone}
              readOnly={isCampaignMode}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, tone: val });
                markDirty();
              }}
            />

            <ClickToEditField
              label="Setting Overview (Zone 1 Static Prefix)"
              value={globalRules.setting_overview}
              readOnly={isCampaignMode}
              multiline
              rows={3}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, setting_overview: val });
                markDirty();
              }}
            />

            <ClickToEditField
              label="Technology / Magic / World Consistency Rules"
              value={globalRules.tech_or_magic_rules}
              readOnly={isCampaignMode}
              multiline
              rows={2}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, tech_or_magic_rules: val });
                markDirty();
              }}
            />
          </div>

          {/* Media Tab */}
          <WorldMediaTab
            isActive={activeTab === "media"}
            mode={mode}
            worldId={activeWorldId}
            media={media}
            containers={effectiveContainers}
            locations={effectiveLocations}
            isDirty={isDirty}
            appSettings={appSettings}
            isAdmin={isAdmin}
            onWorldMutated={handleWorldMediaMutated}
          />

          {/* Map Tab */}
          <div
            style={{
              display: activeTab === "map" ? "flex" : "none",
              flexDirection: "column",
              gap: 10,
              flex: 1,
              minHeight: 420,
              height: "100%",
            }}
          >
            {effectiveLocations.length === 0 ? (
              <div
                style={{
                  padding: 30,
                  textAlign: "center",
                  background: "var(--bg-deep)",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
                  No spatial locations defined. Add an initial starting hub or generate a map with AI.
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-amber"
                    onClick={() => {
                      const newId = `new_loc_${Date.now()}`;
                      setLocations([
                        {
                          id: newId,
                          world_id: world.id,
                          name: "Main Plaza / Starting Hub",
                          summary: "Central arrival threshold and starting hub.",
                          description:
                            "The primary gathering hub and central gateway connecting adjoining sectors.",
                          environmental_tags: ["hub", "central", "open"],
                          is_starting_location: true,
                          is_hub: false,
                        },
                      ]);
                      markDirty();
                    }}
                  >
                    <Plus size={14} /> Create Starting Hub
                  </button>
                  <button
                    type="button"
                    className="btn btn-purple"
                    onClick={() => setShowReimagineModal(true)}
                  >
                    <Sparkles size={14} /> Re-imagine Map with AI
                  </button>
                </div>
              </div>
            ) : (
              <SpatialTopologyView
                title={`${name} — Spatial Topology (${effectiveLocations.length} Locations, ${effectiveEdges.length} Passages)`}
                containers={effectiveContainers}
                locations={effectiveLocations}
                edges={effectiveEdges}
                activeLocationId={
                  activeLocationId ??
                  (effectiveLocations.find((l) => l.is_starting_location)?.id ??
                    effectiveLocations[0]?.id ??
                    "")
                }
                mode={isCampaignMode ? "campaign" : "editor"}
                isMutatingLocked={
                  isCampaignMode && !campaignUnlockLore ? true : isMutatingLocked
                }
                unlockLore={isCampaignMode ? campaignUnlockLore : false}
                revealedLoreIds={revealedLoreIds}
                revealedEdgeIds={revealedEdgeIds}
                revealedPropIds={revealedPropIds}
                worldArtifactLore={loreNodes.filter(
                  (ln) => ln.category === "artifact"
                )}
                propTransferTargets={[
                  {
                    id: "player",
                    label: activePersona?.name
                      ? `Player (${activePersona.name})`
                      : "Player",
                  },
                  ...campaignCharacters.map((c) => ({
                    id: c.record.id,
                    label: c.record.name,
                  })),
                ]}
                onSaveCampaignLocationLore={onSaveCampaignLocationLore}
                onSaveCampaignContainerLore={onSaveCampaignContainerLore}
                onToggleLoreReveal={onToggleCampaignLoreReveal}
                onToggleEdgeReveal={onToggleCampaignEdgeReveal}
                onSaveCampaignLocationProps={onSaveCampaignLocationProps}
                onTogglePropReveal={onToggleCampaignPropReveal}
                onTransferProp={onTransferCampaignProp}
                externalFocusRequest={externalMapFocus}
                worldMedia={media}
                visitedContainerIds={visitedContainerIds}
                worldContext={{
                  worldId: activeWorldId,
                  worldName: name,
                  genre: globalRules.genre,
                  tone: globalRules.tone,
                  settingOverview: globalRules.setting_overview,
                }}
                hasUnsavedChanges={isDirty}
                isSavingMap={saving}
                onSaveMap={
                  isCampaignMode
                    ? onSaveCampaignMap
                    : mode === "wizard"
                    ? undefined
                    : () => handleSave({ closeAfter: false })
                }
                onSaveAndCloseMap={
                  isCampaignMode || mode === "wizard"
                    ? undefined
                    : () => handleSave({ closeAfter: true })
                }
                onRequestClose={isCampaignMode ? requestClose : undefined}
                onChangeGraph={
                  isCampaignMode
                    ? undefined
                    : ({
                        containers: nextConts,
                        locations: nextLocs,
                        edges: nextEdges,
                      }) => {
                        setContainers(nextConts);
                        setLocations(nextLocs);
                        setEdges(nextEdges);
                        markDirty();
                      }
                }
                onReimagineMap={
                  isCampaignMode ? undefined : () => setShowReimagineModal(true)
                }
                onOpenMechanicsHelp={(topicId) =>
                  handleOpenInternalMechanicsHelp(topicId, {
                    kind: "tab",
                    tab: "map",
                    label: "Map",
                  })
                }
              />
            )}
          </div>

          {/* Codex Tab */}
          <WorldCodexTab
            worldId={activeWorldId}
            isActive={activeTab === "codex"}
            isCampaignMode={isCampaignMode}
            unlockLore={isCampaignMode ? campaignUnlockLore : false}
            revealedLoreIds={revealedLoreIds}
            isMutatingLocked={isMutatingLocked}
            campaignId={campaignId}
            loreNodes={effectiveLoreNodes}
            pendingWorldLoreTagDrafts={pendingWorldLoreTagDrafts}
            containers={effectiveContainers}
            locations={effectiveLocations}
            visitedContainerIds={visitedContainerIds}
            activeLocationId={activeLocationId}
            activeWorldName={name}
            worldContext={{
              worldId: activeWorldId,
              worldName: name,
              genre: globalRules.genre,
              tone: globalRules.tone,
              settingOverview: globalRules.setting_overview,
            }}
            activePersona={activePersona}
            activePersonaTurnState={activePersonaTurnState}
            campaignCharacters={campaignCharacters}
            characterNameMap={characterNameMap}
            activeBranchTurns={activeBranchTurns}
            externalFocusRequest={codexFocusRequest}
            onReturnToWorldTab={(tab) => setActiveTab(tab)}
            onItemAction={onToggleItemEquip}
            onSaveMemories={onUpdateCampaignMemories}
            onRelocateCharacter={onOverrideCharacterLocation}
            onOverrideCharacterPhysicalState={onOverrideCharacterPhysicalState}
            onOverrideCharacterObjective={onOverrideCharacterObjective}
            onOverridePlayerPhysicalState={onOverridePlayerPhysicalState}
            onUpdateLoreNodes={(updater) => {
              setLoreNodes(updater);
              if (isCampaignMode) {
                setCampaignWorldLoreDirty(true);
              }
            }}
            onUpdatePendingTagDrafts={(updater) =>
              setPendingWorldLoreTagDrafts(updater)
            }
            onMarkDirty={markDirty}
            onSaveCampaignLocationLore={onSaveCampaignLocationLore}
            onSaveCampaignContainerLore={onSaveCampaignContainerLore}
            onToggleLoreReveal={onToggleCampaignLoreReveal}
            onOpenOnMap={(kind, id) => {
              setExternalMapFocus({
                kind,
                id,
                nonce: ++focusNonceRef.current,
              });
              setActiveTab("map");
            }}
          />

          {/* World Settings Tab */}
          <div
            style={{
              display: activeTab === "settings" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: "0.76rem",
                color: "var(--text-secondary)",
                background: "var(--bg-card)",
                padding: "9px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-subtle)",
                lineHeight: 1.45,
              }}
            >
              {isCampaignMode
                ? "These settings apply strictly to this running campaign starting from future arrivals. They never modify the base world or rewrite earlier turns."
                : "Default world settings inherited when launching new campaigns. Updating this toggle never alters already running campaigns."}
            </div>

            {isCampaignMode && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  background: "var(--bg-card)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  padding: "12px 14px",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>
                    Narrative Voice (Locked)
                  </span>
                  <span style={{ fontSize: "0.76rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                    Selected when this campaign launched and kept fixed across all turns.
                  </span>
                </div>
                <span className="badge" style={{ flexShrink: 0 }}>
                  {campaignWorldSettings?.narrative_voice === "storyteller"
                    ? "3rd-Person Storyteller"
                    : "1st-Person In-Character"}
                </span>
              </div>
            )}

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: "12px 14px",
                cursor: isCampaignMode && isMutatingLocked ? "not-allowed" : "pointer",
                opacity: isCampaignMode && isMutatingLocked ? 0.65 : 1,
              }}
            >
              <input
                type="checkbox"
                style={{ marginTop: 3 }}
                disabled={isCampaignMode && isMutatingLocked}
                checked={
                  isCampaignMode
                    ? campaignDescribeFirstVisit
                    : globalRules.describe_on_first_visit ?? true
                }
                onChange={(e) => {
                  const nextVal = e.target.checked;
                  if (isCampaignMode) {
                    setCampaignDescribeFirstVisit(nextVal);
                  } else {
                    setGlobalRules({
                      ...globalRules,
                      describe_on_first_visit: nextVal,
                    });
                  }
                  markDirty();
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>
                  Describe on First Visit
                </span>
                <span style={{ fontSize: "0.76rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                  Automatically show collapsible atmospheric description cards from the world map when arriving at unvisited locations or containers—without extra LLM calls or context overhead.
                </span>
              </div>
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: "12px 14px",
                cursor: isCampaignMode && isMutatingLocked ? "not-allowed" : "pointer",
                opacity: isCampaignMode && isMutatingLocked ? 0.6 : 1,
              }}
            >
              <input
                type="checkbox"
                style={{ marginTop: 3 }}
                disabled={isCampaignMode && isMutatingLocked}
                checked={
                  isCampaignMode
                    ? campaignAutoSpawnOnSearchCrit
                    : Boolean(globalRules.auto_spawn_props_on_search_crit)
                }
                onChange={(e) => {
                  const nextVal = e.target.checked;
                  if (isCampaignMode) {
                    setCampaignAutoSpawnOnSearchCrit(nextVal);
                  } else {
                    setGlobalRules({
                      ...globalRules,
                      auto_spawn_props_on_search_crit: nextVal,
                    });
                  }
                  markDirty();
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>
                  Auto-spawn situational props on /search Critical Success
                </span>
                <span style={{ fontSize: "0.76rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                  Off by default. On an unpinned Critical Success (d20 + bonus &gt;= 20 or natural 20) from /search in a room with 0 uncollected props, creates up to 1 bounded utility prop (clue, mundane tool, minor consumable, or improvised aid — never weapons, currencies, or master keys) once per room.
                </span>
              </div>
            </label>

            <label
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                background: "var(--bg-card)",
                border:
                  isCampaignMode && campaignUnlockLore
                    ? "1px solid rgba(245, 158, 11, 0.5)"
                    : "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: "12px 14px",
                cursor:
                  !isCampaignMode || isMutatingLocked || savingGmToggle
                    ? "not-allowed"
                    : "pointer",
                opacity: !isCampaignMode || isMutatingLocked || savingGmToggle ? 0.6 : 1,
              }}
            >
              <input
                type="checkbox"
                style={{ marginTop: 3 }}
                disabled={!isCampaignMode || isMutatingLocked || savingGmToggle}
                checked={isCampaignMode ? campaignUnlockLore : false}
                onChange={async (e) => {
                  if (!isCampaignMode) return;
                  const nextVal = e.target.checked;
                  setCampaignUnlockLore(nextVal);
                  if (!nextVal) {
                    setCampaignWorldLoreDirty(false);
                    setLoreNodes(
                      world.lore_nodes.map((lore) => ({
                        ...lore,
                        category: WORLD_LORE_CATEGORIES.includes(
                          lore.category as WorldLoreCategory
                        )
                          ? (lore.category as WorldLoreCategory)
                          : "faction",
                        entity_tags: [...lore.entity_tags],
                      }))
                    );
                  }
                  if (onSaveCampaignWorldSettings) {
                    setSavingGmToggle(true);
                    setError(null);
                    try {
                      await onSaveCampaignWorldSettings({
                        describe_on_first_visit: campaignDescribeFirstVisit,
                        unlock_lore: nextVal,
                        auto_spawn_props_on_search_crit: campaignAutoSpawnOnSearchCrit,
                      });
                    } catch (err) {
                      setCampaignUnlockLore(!nextVal);
                      setError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setSavingGmToggle(false);
                    }
                  } else {
                    markDirty();
                  }
                }}
              />
              <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
                  <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-primary)" }}>
                    Unlock Lore &amp; Secrets (GM Mode)
                  </span>
                  <MechanicsHelpButton
                    topicId="gm-mode"
                    label="Unlock Lore & Secrets (GM Mode)"
                    onOpenHelp={(topicId) =>
                      handleOpenInternalMechanicsHelp(topicId, {
                        kind: "tab",
                        tab: "settings",
                        label: "World Settings",
                      })
                    }
                  />
                </div>
                {isCampaignMode ? (
                  <>
                    <span style={{ fontSize: "0.76rem", color: "var(--text-secondary)", lineHeight: 1.45 }}>
                      Reveals all hidden location/container secrets in the Codex and Map Inspector (UI-only—AI characters still follow in-game discovery rules) and unlocks adding, editing, or deleting lore in the Codex, Locations, L1 Containers, visited location details, and Story Major Events.
                    </span>
                    <span style={{ fontSize: "0.72rem", color: "var(--accent-amber)", lineHeight: 1.45 }}>
                      Tip: Lore changes apply only to this campaign from the current turn onward and never alter the base world. If you branch or rewind to an earlier turn (e.g., branching from Turn 4 after editing at Turn 8), later lore edits will not appear on that branch.
                    </span>
                  </>
                ) : (
                  <span style={{ fontSize: "0.76rem", color: "var(--text-muted)", lineHeight: 1.45 }}>
                    Campaign-only GM override. Disabled in World Edit mode because all world lore and secrets are already visible and editable here.
                  </span>
                )}
              </div>
            </label>
          </div>

          {unsupportedKeysCount > 0 && (
            <UnsupportedFieldsTab
              isActive={activeTab === "unsupported"}
              unsupportedFields={unsupportedFields}
              stagedDeletes={stagedUnsupportedDeletes}
              readOnly={isCampaignMode || isMutatingLocked}
              accentColor="cyan"
              deprecatedKeys={DEPRECATED_WORLD_KEYS}
              saveActionLabel="Save Changes"
              onStageDelete={handleStageUnsupportedDelete}
              onUndoDelete={handleUndoUnsupportedDelete}
              renderFieldActions={(key, value) => {
                if (typeof value !== "string") return null;
                if (
                  key === "global_rules.narrative_style" ||
                  key === "global_rules.sensory_profile"
                ) {
                  return (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          handleMigrateWorldRuleText(key, "tone", value, false)
                        }
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <ArrowRight size={13} />
                        {globalRules.tone.trim() ? "Append to Tone" : "Copy to Tone"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          handleMigrateWorldRuleText(key, "tone", value, true)
                        }
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <ArrowRight size={13} />
                        Move to Tone &amp; Delete
                      </button>
                    </>
                  );
                }
                if (key === "global_rules.taboos_and_limits") {
                  return (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          handleMigrateWorldRuleText(
                            key,
                            "tech_or_magic_rules",
                            value,
                            false
                          )
                        }
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <ArrowRight size={13} />
                        {globalRules.tech_or_magic_rules.trim()
                          ? "Append to World Rules"
                          : "Copy to World Rules"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() =>
                          handleMigrateWorldRuleText(
                            key,
                            "tech_or_magic_rules",
                            value,
                            true
                          )
                        }
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <ArrowRight size={13} />
                        Move to World Rules &amp; Delete
                      </button>
                    </>
                  );
                }
                return null;
              }}
            />
          )}

          {error && (
            <div
              style={{
                color: "#fda4af",
                background: "rgba(244, 63, 94, 0.1)",
                border: "1px solid rgba(244, 63, 94, 0.35)",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: "0.78rem",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div
          className={`modal-footer${
            isCampaignMode && !isDirty && activeTab === "codex"
              ? " modal-footer--hide-mobile-readonly"
              : ""
          }`}
        >
          {mode === "wizard" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {onBackToSeed && (
                  <button
                    type="button"
                    className="btn"
                    disabled={saving}
                    onClick={onBackToSeed}
                  >
                    ← Back to Seed
                  </button>
                )}
                <span
                  style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}
                >
                  {isDirty
                    ? "Draft customized. Ready to commit world & spatial graph."
                    : "Click any field above or switch tabs to customize before committing."}
                </span>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={saving}
                  onClick={requestClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-cyan"
                  disabled={saving || locations.length === 0 || mapHasBlockingErrors}
                  onClick={() => {
                    void handleSave({ closeAfter: true });
                  }}
                >
                  <Check size={15} />
                  {saving ? "Saving..." : "Commit World & Spatial Graph"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}
              >
                {isCampaignMode
                  ? effectiveIsDirty
                    ? "Unsaved campaign setting change ready. Applies from future turns only."
                    : justSaved
                    ? "Changes saved."
                    : "Adjust World Settings to customize this campaign independently."
                  : mapHasBlockingErrors
                  ? "Resolve unlinked locations or hierarchy errors on the Map tab before saving."
                  : isDirty
                  ? "Unsaved edits ready. Saving preserves existing campaigns via silent versioning."
                  : justSaved
                  ? "Changes saved."
                  : "Click any field above to edit."}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                {!isCampaignMode && (
                  <button
                    type="button"
                    className="btn"
                    disabled={exportingWorld}
                    onClick={() => setShowExportDialog(true)}
                    title="Export this world as a .zcc package"
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <Upload size={14} color="var(--accent-cyan)" />
                    {exportingWorld ? "Exporting..." : "Export (.zcc)"}
                  </button>
                )}
                <button type="button" className="btn" onClick={requestClose}>
                  {effectiveIsDirty ? "Cancel" : "Close"}
                </button>
                {effectiveIsDirty && (
                  <SplitSaveButton
                    variantClass="btn-amber"
                    disabled={
                      saving ||
                      (!isCampaignMode && mapHasBlockingErrors) ||
                      (isCampaignMode && isMutatingLocked)
                    }
                    menuDirection="up"
                    menuAlign="right"
                    testId="world-modal-save-btn"
                    onSave={() => handleSave({ closeAfter: false })}
                    onSaveAndClose={() => handleSave({ closeAfter: true })}
                    label={
                      <>
                        <Check size={14} />
                        {saving ? "Saving..." : "Save Changes"}
                      </>
                    }
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Export World Options Modal */}
      {showExportDialog && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 1200 }}
          onClick={() => !exportingWorld && setShowExportDialog(false)}
        >
          <div
            className="modal-panel"
            style={{ width: "min(420px, 92vw)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--accent-cyan)" }}>
                <Upload size={16} />
                Export World (.zcc)
              </span>
              <button
                type="button"
                className="btn"
                disabled={exportingWorld}
                onClick={() => setShowExportDialog(false)}
              >
                <X size={14} />
              </button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.84rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={exportIncludeChars}
                  onChange={(e) => setExportIncludeChars(e.target.checked)}
                />
                <span>Include resident characters belonging to this world</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.84rem", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={exportIncludeMedia}
                  onChange={(e) => setExportIncludeMedia(e.target.checked)}
                />
                <span>Include world media files</span>
              </label>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn"
                disabled={exportingWorld}
                onClick={() => setShowExportDialog(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-cyan"
                disabled={exportingWorld}
                onClick={handleExportWorld}
              >
                <Upload size={14} />
                {exportingWorld ? "Exporting..." : "Download .zcc"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Re-imagine Spatial Map Modal */}
      {showReimagineModal && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 1200 }}
          onClick={() => !reimagining && setShowReimagineModal(false)}
        >
          <div
            className="modal-panel"
            style={{ width: "min(620px, 95vw)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--accent-purple, #c084fc)",
                }}
              >
                <Sparkles size={18} />
                Re-imagine Spatial Map with AI
              </span>
              <button
                type="button"
                className="btn"
                disabled={reimagining}
                onClick={() => setShowReimagineModal(false)}
              >
                <X size={15} />
              </button>
            </div>

            <div
              className="modal-body"
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div
                style={{
                  fontSize: "0.78rem",
                  color: "var(--text-secondary)",
                  background: "var(--bg-card)",
                  padding: "10px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                  lineHeight: 1.5,
                }}
              >
                Describe your desired layout, locations, or spatial atmosphere for{" "}
                <strong>{name}</strong> ({globalRules.genre}). The AI will
                regenerate the interconnected locations and passages to match your
                vision while preserving existing world rules and lore.
              </div>

              {reimagineError && (
                <div
                  style={{
                    color: "var(--accent-rose)",
                    fontSize: "0.82rem",
                    background: "rgba(244, 63, 94, 0.1)",
                    padding: "8px 12px",
                    borderRadius: 6,
                  }}
                >
                  {reimagineError}
                </div>
              )}

              <div className="field-group">
                <label>Desired Map Vision & Spatial Layout</label>
                <textarea
                  className="field-textarea"
                  rows={4}
                  placeholder="e.g. A multi-level subterranean bunker: a fortified decontamination airlock at the surface, branching down via service elevator to an overgrown hydroponics lab, a humming power core, and a flooded sub-level tunnel..."
                  value={reimagineDescription}
                  onChange={(e) => setReimagineDescription(e.target.value)}
                  disabled={reimagining}
                  autoFocus
                />
              </div>

              <div className="field-group">
                <label>Target Location Count (3–8)</label>
                <input
                  type="number"
                  className="field-input"
                  min={3}
                  max={8}
                  value={reimagineCount}
                  onChange={(e) =>
                    setReimagineCount(
                      Math.max(3, Math.min(8, parseInt(e.target.value, 10) || 4))
                    )
                  }
                  disabled={reimagining}
                />
              </div>

              <div style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                Note: Regenerating the map replaces current draft locations and
                passages with the newly synthesized spatial topology. World
                rules, overview, existing location containers,
                and world-level lore entries remain intact.
              </div>

              {locationsWithLoreCount > 0 && (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#fde68a",
                    background: "rgba(245, 158, 11, 0.12)",
                    border: "1px solid rgba(245, 158, 11, 0.4)",
                    borderRadius: 6,
                    padding: "8px 12px",
                  }}
                >
                  <strong>Warning:</strong> Replacing the map will discard{" "}
                  <strong>{locationsWithLoreCount}</strong> location-attached lore
                  entry/entries on your current locations.
                </div>
              )}
            </div>

            <div
              className="modal-footer"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                padding: "12px 16px",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <button
                type="button"
                className="btn"
                disabled={reimagining}
                onClick={() => setShowReimagineModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-purple"
                disabled={reimagining || !reimagineDescription.trim()}
                onClick={handleExecuteReimagine}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Sparkles size={14} />
                {reimagining ? "Re-imagining Map..." : "Regenerate Map"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
