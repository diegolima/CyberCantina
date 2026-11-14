import React, { useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Check,
  Compass,
  Globe,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { api } from "../../api";
import {
  LOCATION_LORE_CATEGORIES,
  WORLD_LORE_CATEGORIES,
} from "../../types";
import type {
  LocationContainer,
  LocationEdge,
  LocationLoreCategory,
  LocationNode,
  LoreNode,
  WorldGlobalRules,
  WorldLoreCategory,
  WorldRecord,
} from "../../types";
import { SpatialTopologyView } from "../SpatialTopologyView";
import { TagChipsInput, normalizeTagList } from "../TagChipsInput";
import {
  computeUnreachableLocationIds,
  validateContainersState,
} from "../map/mapValidation";
import { ClickToEditField } from "../shared/ClickToEditField";
import { mapDraftToNodesAndEdges } from "./worldDraftMappers";

interface WorldInspectorModalProps {
  world: WorldRecord;
  onClose: () => void;
  onSaved: (updated: WorldRecord) => void;
  mode?: "inspector" | "wizard";
  onBackToSeed?: () => void;
  onCommitDraft?: (payload: {
    name: string;
    global_rules: WorldGlobalRules;
    containers: LocationContainer[];
    locations: LocationNode[];
    edges: LocationEdge[];
    lore_nodes: LoreNode[];
  }) => Promise<WorldRecord>;
}

type WorldTab = "base" | "map" | "lore";

export const WorldInspectorModal: React.FC<WorldInspectorModalProps> = ({
  world,
  onClose,
  onSaved,
  mode = "inspector",
  onBackToSeed,
  onCommitDraft,
}) => {
  const [activeTab, setActiveTab] = useState<WorldTab>("base");
  const [name, setName] = useState(world.name);
  const [globalRules, setGlobalRules] = useState({ ...world.global_rules });
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

  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingWorld, setExportingWorld] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loreListBottomRef = useRef<HTMLDivElement | null>(null);

  const handleAddWorldLoreNode = () => {
    const newId = `new_lore_${Date.now()}`;
    setLoreNodes((prev) => [
      ...prev,
      {
        id: newId,
        world_id: world.id,
        title: "New Lore Entry",
        category: "faction",
        content:
          "Describe a macro faction, historical event, cultural norm, or world rumor...",
        entity_tags: [],
      },
    ]);
    markDirty();
    setTimeout(() => {
      loreListBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const el = document.getElementById(`lore-node-${newId}`);
      if (el) {
        const input = el.querySelector("input, textarea") as HTMLElement;
        if (input) input.focus();
      }
    }, 60);
  };

  const handleExportWorld = async () => {
    setExportingWorld(true);
    try {
      const includeChars = window.confirm("Include resident characters belonging to this world in the export package?");
      await api.exportWorld(world.id, includeChars);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setExportingWorld(false);
    }
  };

  // Re-imagine Map Modal state
  const [showReimagineModal, setShowReimagineModal] = useState(false);
  const [reimagineDescription, setReimagineDescription] = useState("");
  const [reimagineCount, setReimagineCount] = useState(
    Math.max(3, Math.min(8, locations.length || 4))
  );
  const [reimagining, setReimagining] = useState(false);
  const [reimagineError, setReimagineError] = useState<string | null>(null);

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
  };

  const reachabilityReport = computeUnreachableLocationIds(locations, edges);
  const containerValidationErrors = validateContainersState(containers, locations);
  const mapHasBlockingErrors =
    Boolean(reachabilityReport.starterError) ||
    reachabilityReport.unreachableIds.length > 0 ||
    containerValidationErrors.length > 0;

  const invalidWorldLoreCount = loreNodes.filter((lore) => {
    const pendingRaw = pendingWorldLoreTagDrafts[lore.id] || "";
    const pendingParts = pendingRaw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const effectiveTags = normalizeTagList(lore.entity_tags || [], pendingParts);
    return (
      !lore.title.trim() ||
      !lore.content.trim() ||
      !WORLD_LORE_CATEGORIES.includes(lore.category as WorldLoreCategory) ||
      effectiveTags.length === 0
    );
  }).length;

  const invalidLocationLoreCount = locations.reduce((acc, loc) => {
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

  const locationsWithLoreCount = locations.reduce(
    (acc, loc) => acc + (loc.lore_nodes?.length ?? 0),
    0
  );

  const handleSave = async () => {
    if (locations.length === 0) {
      setError("At least one location is required.");
      return;
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
        setActiveTab("lore");
        setError(
          `World Lore entry #${i + 1} ("${
            item.title || "Untitled"
          }") must have a non-empty title, content, and at least 1 trigger keyword.`
        );
        return;
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
          return;
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
      return;
    }

    const saveReach = computeUnreachableLocationIds(sanitizedLocations, edges);
    if (saveReach.starterError || saveReach.unreachableIds.length > 0) {
      setActiveTab("map");
      setError(
        saveReach.starterError ||
          `${saveReach.unreachableIds.length} unlinked location(s) must be bidirectionally connected to the Starting Location before saving.`
      );
      return;
    }

    setLoreNodes(flushedWorldLore);
    setContainers(sanitizedContainers);
    setLocations(sanitizedLocations);
    setPendingWorldLoreTagDrafts({});

    setSaving(true);
    setError(null);
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
          : await api.updateWorld(world.id, payload);
      onSaved(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={mode === "wizard" ? undefined : onClose}
    >
      <div
        className="modal-panel"
        style={{
          width: activeTab === "map" ? "min(1120px, 96vw)" : "min(860px, 95vw)",
          transition: "width 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Globe size={18} color="var(--accent-cyan)" />
            World Sheet
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
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

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
            aria-selected={activeTab === "map"}
            className={`modal-tab-btn ${activeTab === "map" ? "active" : ""}`}
            onClick={() => setActiveTab("map")}
          >
            <Compass size={14} />
            <span>Map</span>
            <span className="modal-tab-badge">{locations.length}</span>
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
            aria-selected={activeTab === "lore"}
            className={`modal-tab-btn ${activeTab === "lore" ? "active" : ""}`}
            onClick={() => setActiveTab("lore")}
          >
            <BookOpen size={14} />
            <span>Lore</span>
            <span className="modal-tab-badge">{loreNodes.length}</span>
            {invalidWorldLoreCount > 0 && (
              <span
                className="modal-tab-badge"
                style={{
                  background: "rgba(244, 63, 94, 0.22)",
                  color: "#fda4af",
                  border: "1px solid rgba(244, 63, 94, 0.5)",
                }}
                title={`${invalidWorldLoreCount} incomplete world lore entry/entries`}
              >
                !{invalidWorldLoreCount}
              </span>
            )}
          </button>
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
                ? "Click on any field below to edit it, or switch to the Map and Lore tabs above to customize locations, passages, and GraphRAG lore before committing your world."
                : "Click on any field below to edit it. Active campaigns running in this world remain pinned to their original world snapshot automatically."}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
              }}
            >
              <ClickToEditField
                label="World Name"
                value={name}
                onChange={(val) => {
                  setName(val);
                  markDirty();
                }}
              />
              <ClickToEditField
                label="Genre"
                value={globalRules.genre}
                onChange={(val) => {
                  setGlobalRules({ ...globalRules, genre: val });
                  markDirty();
                }}
              />
              <ClickToEditField
                label="Starting Clock (YYYY-MM-DD HH:MM)"
                value={globalRules.starting_timestamp}
                onChange={(val) => {
                  setGlobalRules({ ...globalRules, starting_timestamp: val });
                  markDirty();
                }}
              />
            </div>

            <ClickToEditField
              label="Narrative Tone & Stylistic Atmosphere"
              value={globalRules.tone}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, tone: val });
                markDirty();
              }}
            />

            <ClickToEditField
              label="Setting Overview (Zone 1 Static Prefix)"
              value={globalRules.setting_overview}
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
              multiline
              rows={2}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, tech_or_magic_rules: val });
                markDirty();
              }}
            />
          </div>

          {/* Map Tab */}
          <div
            style={{
              display: activeTab === "map" ? "flex" : "none",
              flexDirection: "column",
              gap: 10,
              minHeight: 520,
              height: "calc(88vh - 220px)",
            }}
          >
            {locations.length === 0 ? (
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
                title={`${name} — Spatial Topology (${locations.length} Locations, ${edges.length} Passages)`}
                containers={containers}
                locations={locations}
                edges={edges}
                activeLocationId={
                  locations.find((l) => l.is_starting_location)?.id ??
                  locations[0]?.id ??
                  ""
                }
                mode="editor"
                worldContext={{
                  worldId: world.id,
                  worldName: name,
                  genre: globalRules.genre,
                  tone: globalRules.tone,
                  settingOverview: globalRules.setting_overview,
                }}
                hasUnsavedChanges={isDirty}
                isSavingMap={saving}
                onSaveMap={handleSave}
                onChangeGraph={({
                  containers: nextConts,
                  locations: nextLocs,
                  edges: nextEdges,
                }) => {
                  setContainers(nextConts);
                  setLocations(nextLocs);
                  setEdges(nextEdges);
                  markDirty();
                }}
                onReimagineMap={() => setShowReimagineModal(true)}
              />
            )}
          </div>

          {/* Lore Tab */}
          <div
            style={{
              display: activeTab === "lore" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* World Lore Nodes */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  position: "sticky",
                  top: -18,
                  zIndex: 10,
                  background: "var(--bg-card)",
                  padding: "8px 0",
                  margin: "-4px 0 0 0",
                  borderBottom: "1px solid var(--border-subtle)",
                }}
              >
                <span
                  className="sidebar-label"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <BookOpen size={13} color="var(--accent-violet)" />
                  World Macro Lore — Factions, History, Culture &amp; Rumors ({loreNodes.length})
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={handleAddWorldLoreNode}
                >
                  <Plus size={12} /> Add Lore Node
                </button>
              </div>

              {loreNodes.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No world lore nodes indexed. Add macro lore for factions, history, culture, and rumors (attach location-specific lore &amp; secrets on the Map tab).
                </div>
              ) : (
                loreNodes.map((lore, idx) => {
                  const pendingRaw = pendingWorldLoreTagDrafts[lore.id] || "";
                  const hasTags =
                    lore.entity_tags.length > 0 || Boolean(pendingRaw.trim());
                  const isEntryInvalid =
                    !lore.title.trim() || !lore.content.trim() || !hasTags;

                  return (
                    <div
                      key={lore.id}
                      id={`lore-node-${lore.id}`}
                      style={{
                        background: "var(--bg-panel)",
                        border: isEntryInvalid
                          ? "1px solid rgba(244, 63, 94, 0.55)"
                          : "1px solid var(--border-subtle)",
                        borderRadius: 6,
                        padding: 10,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.1fr 130px 1.4fr auto",
                          gap: 8,
                          alignItems: "start",
                        }}
                      >
                        <ClickToEditField
                          label="Lore Title"
                          value={lore.title}
                          onChange={(val) => {
                            const next = [...loreNodes];
                            next[idx] = { ...next[idx], title: val };
                            setLoreNodes(next);
                            markDirty();
                          }}
                        />
                        <div className="field-group">
                          <label>Category</label>
                          <select
                            className="field-select"
                            value={lore.category}
                            onChange={(e) => {
                              const next = [...loreNodes];
                              next[idx] = {
                                ...next[idx],
                                category: e.target.value as WorldLoreCategory,
                              };
                              setLoreNodes(next);
                              markDirty();
                            }}
                          >
                            {WORLD_LORE_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field-group">
                          <label>Trigger Keywords (min 1)</label>
                          <TagChipsInput
                            value={lore.entity_tags}
                            accentVariant="violet"
                            placeholder="Add keyword & press Enter..."
                            onDraftChange={(draftStr) => {
                              setPendingWorldLoreTagDrafts((prev) => ({
                                ...prev,
                                [lore.id]: draftStr,
                              }));
                            }}
                            onChange={(nextTags) => {
                              const next = [...loreNodes];
                              next[idx] = {
                                ...next[idx],
                                entity_tags: nextTags,
                              };
                              setLoreNodes(next);
                              markDirty();
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          className="item-remove-btn"
                          style={{ marginTop: 22 }}
                          onClick={() => {
                            setLoreNodes(loreNodes.filter((_, i) => i !== idx));
                            setPendingWorldLoreTagDrafts((prev) => {
                              const copy = { ...prev };
                              delete copy[lore.id];
                              return copy;
                            });
                            markDirty();
                          }}
                          title="Remove lore node"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <ClickToEditField
                        label="Lore Content"
                        value={lore.content}
                        multiline
                        rows={2}
                        onChange={(val) => {
                          const next = [...loreNodes];
                          next[idx] = { ...next[idx], content: val };
                          setLoreNodes(next);
                          markDirty();
                        }}
                      />
                    </div>
                  );
                })
              )}
              <div ref={loreListBottomRef} />
              {loreNodes.length > 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.74rem" }}
                    onClick={handleAddWorldLoreNode}
                  >
                    <Plus size={13} /> Add Another Lore Node
                  </button>
                </div>
              )}
            </div>
          </div>

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

        <div className="modal-footer">
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
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-cyan"
                  disabled={saving || locations.length === 0 || mapHasBlockingErrors}
                  onClick={handleSave}
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
                {mapHasBlockingErrors
                  ? "Resolve unlinked locations or hierarchy errors on the Map tab before saving."
                  : isDirty
                  ? "Unsaved edits ready. Saving preserves existing campaigns via silent versioning."
                  : "Click any field above to edit."}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={exportingWorld}
                  onClick={handleExportWorld}
                  title="Export this world as a .zcc package"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Upload size={14} color="var(--accent-cyan)" />
                  {exportingWorld ? "Exporting..." : "Export (.zcc)"}
                </button>
                <button type="button" className="btn" onClick={onClose}>
                  {isDirty ? "Cancel" : "Close"}
                </button>
                {isDirty && (
                  <button
                    type="button"
                    className="btn btn-amber"
                    disabled={saving || mapHasBlockingErrors}
                    onClick={handleSave}
                  >
                    <Check size={14} />
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

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
