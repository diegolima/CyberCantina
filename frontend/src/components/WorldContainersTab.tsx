import React, { useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  DoorOpen,
  EyeOff,
  FolderOpen,
  Layers,
  MapPin,
  Plus,
  Trash2,
} from "lucide-react";
import {
  LOCATION_LORE_CATEGORIES,
  LocationContainer,
  LocationLoreCategory,
  LocationNode,
  LoreNode,
} from "../types";
import { CONTAINER_DEPTH_LABELS } from "./SpatialTopologyView";
import { TagChipsInput } from "./TagChipsInput";

export interface WorldContainersTabProps {
  worldId: string;
  containers: LocationContainer[];
  locations: LocationNode[];
  worldLoreNodes: LoreNode[];
  onChangeContainers: (next: LocationContainer[]) => void;
  onChangeLocations: (next: LocationNode[]) => void;
  onChangeWorldLoreNodes: (next: LoreNode[]) => void;
  onOpenConvertModal: (loc: LocationNode) => void;
}

/** Compute all descendant container IDs of `rootId` to prevent cycle selections. */
export function getDescendantContainerIds(
  rootId: string,
  containers: LocationContainer[]
): Set<string> {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of containers) {
      if (
        c.parent_container_id &&
        result.has(c.parent_container_id) &&
        !result.has(c.id)
      ) {
        result.add(c.id);
        changed = true;
      }
    }
  }
  return result;
}

/** Validate container tree invariants for World Sheet saving. */
export function validateContainersState(
  containers: LocationContainer[],
  locations: LocationNode[]
): string | null {
  const byId = new Map(containers.map((c) => [c.id, c]));
  for (const c of containers) {
    if (!c.name.trim()) {
      return `Container (Level ${c.depth}) must have a non-empty name.`;
    }
    if (c.parent_container_id) {
      if (c.parent_container_id === c.id) {
        return `Container "${c.name}" cannot be its own parent.`;
      }
      const parent = byId.get(c.parent_container_id);
      if (!parent) {
        return `Container "${c.name}" references a missing parent container.`;
      }
      if (c.depth >= parent.depth) {
        return `Container "${c.name}" (Level ${c.depth}) must sit inside a strictly deeper parent container than itself (parent "${parent.name}" is Level ${parent.depth}).`;
      }
      // Cycle detection
      const seen = new Set<string>([c.id]);
      let curr: LocationContainer | undefined = parent;
      while (curr) {
        if (seen.has(curr.id)) {
          return `Cycle detected in container hierarchy at "${c.name}".`;
        }
        seen.add(curr.id);
        curr = curr.parent_container_id
          ? byId.get(curr.parent_container_id)
          : undefined;
      }
    }
    if (c.depth !== 1 && (c.lore_nodes?.length ?? 0) > 0) {
      return `Container "${c.name}" (Level ${c.depth}) cannot hold Lore entries — lore is only permitted on Level 1 landmarks/buildings.`;
    }
    if (c.depth === 1) {
      for (let i = 0; i < (c.lore_nodes ?? []).length; i++) {
        const ln = c.lore_nodes![i];
        if (
          !ln.title.trim() ||
          !ln.content.trim() ||
          !ln.entity_tags ||
          ln.entity_tags.length === 0
        ) {
          return `Container "${c.name}" Lore entry #${i + 1} ("${
            ln.title.trim() || "Untitled"
          }") must have a title, content, and at least 1 trigger keyword.`;
        }
      }
    }
  }
  for (const loc of locations) {
    if (loc.container_id && !byId.has(loc.container_id)) {
      return `Location "${loc.name}" references a non-existent container.`;
    }
  }
  return null;
}

interface DeleteModalState {
  container: LocationContainer;
  childContainers: LocationContainer[];
  childLocations: LocationNode[];
  hasLevel1Lore: boolean;
  childHandling: "reassign" | "unparent";
  reassignTargetId: string;
  loreDisposal: "delete" | "reassign" | "promote_to_world";
  loreTargetId: string;
}

export const WorldContainersTab: React.FC<WorldContainersTabProps> = ({
  worldId,
  containers,
  locations,
  worldLoreNodes,
  onChangeContainers,
  onChangeLocations,
  onChangeWorldLoreNodes,
  onOpenConvertModal,
}) => {
  const [newDepth, setNewDepth] = useState<1 | 2 | 3 | 4>(1);
  const [expandedContainerId, setExpandedContainerId] = useState<string | null>(
    containers[0]?.id ?? null
  );
  const [expandedLoreIds, setExpandedLoreIds] = useState<Set<string>>(new Set());
  const [deleteModal, setDeleteModal] = useState<DeleteModalState | null>(null);
  const listBottomRef = useRef<HTMLDivElement | null>(null);

  const byId = useMemo(
    () => new Map(containers.map((c) => [c.id, c])),
    [containers]
  );

  // Order containers recursively as hierarchical tree: root L4/L3/L2/L1 down to children
  const orderedTree = useMemo(() => {
    const childrenByParent = new Map<string, LocationContainer[]>();
    const roots: LocationContainer[] = [];
    for (const c of containers) {
      if (c.parent_container_id && byId.has(c.parent_container_id)) {
        const list = childrenByParent.get(c.parent_container_id) ?? [];
        list.push(c);
        childrenByParent.set(c.parent_container_id, list);
      } else {
        roots.push(c);
      }
    }
    const sortFn = (a: LocationContainer, b: LocationContainer) =>
      b.depth - a.depth || a.name.localeCompare(b.name);
    roots.sort(sortFn);

    const flat: Array<{ container: LocationContainer; indent: number }> = [];
    const visited = new Set<string>();
    const walk = (node: LocationContainer, indent: number) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      flat.push({ container: node, indent });
      const kids = [...(childrenByParent.get(node.id) ?? [])].sort(sortFn);
      for (const kid of kids) walk(kid, indent + 1);
    };
    for (const r of roots) walk(r, 0);
    // Fallback for any disconnected cycles in transient invalid state
    for (const c of containers) {
      if (!visited.has(c.id)) flat.push({ container: c, indent: 0 });
    }
    return flat;
  }, [containers, byId]);

  const uncontainedLocations = useMemo(
    () =>
      locations.filter(
        (loc) => !loc.container_id || !byId.has(loc.container_id)
      ),
    [locations, byId]
  );

  const handleAddContainer = () => {
    const newId = `new_cont_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    const created: LocationContainer = {
      id: newId,
      world_id: worldId,
      parent_container_id: null,
      depth: newDepth,
      name: `New ${CONTAINER_DEPTH_LABELS[newDepth]}`,
      description: "",
      environmental_tags: [],
      lore_nodes: [],
    };
    onChangeContainers([...containers, created]);
    setExpandedContainerId(newId);
    setTimeout(() => {
      listBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      const el = document.getElementById(`container-node-${newId}`);
      const input = el?.querySelector("input, textarea") as HTMLElement | null;
      input?.focus();
    }, 60);
  };

  const updateContainer = (id: string, patch: Partial<LocationContainer>) => {
    onChangeContainers(
      containers.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        if (next.depth !== 1 && (next.lore_nodes?.length ?? 0) > 0) {
          next.lore_nodes = [];
        }
        if (next.parent_container_id) {
          const parent = byId.get(next.parent_container_id);
          if (!parent || next.depth >= parent.depth) {
            next.parent_container_id = null;
          }
        }
        return next;
      })
    );
  };

  const moveLocationToContainer = (locId: string, nextContainerId: string | null) => {
    onChangeLocations(
      locations.map((l) =>
        l.id === locId
          ? {
              ...l,
              container_id: nextContainerId,
              is_entry_exit: nextContainerId ? l.is_entry_exit : false,
            }
          : l
      )
    );
  };

  const openDeleteContainer = (target: LocationContainer) => {
    const childContainers = containers.filter(
      (c) => c.parent_container_id === target.id
    );
    const childLocations = locations.filter(
      (l) => l.container_id === target.id
    );
    const hasLevel1Lore =
      target.depth === 1 && (target.lore_nodes?.length ?? 0) > 0;

    if (
      childContainers.length === 0 &&
      childLocations.length === 0 &&
      !hasLevel1Lore
    ) {
      if (window.confirm(`Delete empty container "${target.name}"?`)) {
        onChangeContainers(containers.filter((c) => c.id !== target.id));
      }
      return;
    }

    const validReassignTargets = containers.filter(
      (c) =>
        c.id !== target.id &&
        childContainers.every((cc) => cc.depth < c.depth)
    );
    const validL1LoreTargets = containers.filter(
      (c) => c.id !== target.id && c.depth === 1
    );

    setDeleteModal({
      container: target,
      childContainers,
      childLocations,
      hasLevel1Lore,
      childHandling: validReassignTargets.length > 0 ? "reassign" : "unparent",
      reassignTargetId: validReassignTargets[0]?.id ?? "",
      loreDisposal: "delete",
      loreTargetId: validL1LoreTargets[0]?.id ?? "",
    });
  };

  const confirmDeleteContainer = () => {
    if (!deleteModal) return;
    const {
      container: target,
      childHandling,
      reassignTargetId,
      hasLevel1Lore,
      loreDisposal,
      loreTargetId,
    } = deleteModal;
    const nextParentId =
      childHandling === "reassign" && reassignTargetId
        ? reassignTargetId
        : null;

    let updatedLore = worldLoreNodes;
    if (hasLevel1Lore && loreDisposal === "promote_to_world") {
      const promoted: LoreNode[] = (target.lore_nodes ?? []).map((ln, idx) => ({
        ...ln,
        id: `new_lore_${Date.now()}_${idx}`,
        world_id: worldId,
        location_id: null,
        container_id: null,
        category: ln.category === "secret" ? "rumor" : ln.category,
      }));
      updatedLore = [...worldLoreNodes, ...promoted];
    }

    const updatedContainers = containers
      .filter((c) => c.id !== target.id)
      .map((c) => {
        let copy = { ...c };
        if (copy.parent_container_id === target.id) {
          copy.parent_container_id = nextParentId;
        }
        if (
          hasLevel1Lore &&
          loreDisposal === "reassign" &&
          copy.id === loreTargetId &&
          copy.depth === 1
        ) {
          const movedLore = (target.lore_nodes ?? []).map((ln) => ({
            ...ln,
            container_id: copy.id,
          }));
          copy.lore_nodes = [...(copy.lore_nodes ?? []), ...movedLore];
        }
        return copy;
      });

    const updatedLocations = locations.map((loc) =>
      loc.container_id === target.id
        ? {
            ...loc,
            container_id: nextParentId,
            is_entry_exit: nextParentId ? loc.is_entry_exit : false,
          }
        : loc
    );

    if (updatedLore !== worldLoreNodes) {
      onChangeWorldLoreNodes(updatedLore);
    }
    onChangeContainers(updatedContainers);
    onChangeLocations(updatedLocations);
    setDeleteModal(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Sticky + Add Container Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 8,
          background: "var(--bg-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 8,
          padding: "10px 12px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "0.84rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Layers size={15} color="var(--accent-cyan)" />
            Location Containers ({containers.length})
          </div>
          <div style={{ fontSize: "0.71rem", color: "var(--text-muted)" }}>
            Organize locations under macro realms (L4), cities (L3), districts (L2), or buildings (L1).
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <select
            className="field-select"
            aria-label="New container depth level"
            style={{ fontSize: "0.75rem", padding: "4px 8px" }}
            value={newDepth}
            onChange={(e) =>
              setNewDepth(Number(e.target.value) as 1 | 2 | 3 | 4)
            }
          >
            <option value={4}>L4 · Region / Realm</option>
            <option value={3}>L3 · City / Settlement</option>
            <option value={2}>L2 · District / Zone</option>
            <option value={1}>L1 · Building / Landmark</option>
          </select>
          <button
            type="button"
            className="btn btn-amber"
            style={{ padding: "5px 11px", fontSize: "0.76rem" }}
            onClick={handleAddContainer}
          >
            <Plus size={13} /> Add Container
          </button>
        </div>
      </div>

      {/* Container Tree List */}
      {orderedTree.length === 0 ? (
        <div
          style={{
            padding: 20,
            textAlign: "center",
            color: "var(--text-muted)",
            background: "var(--bg-deep)",
            border: "1px dashed var(--border-subtle)",
            borderRadius: 8,
            fontSize: "0.78rem",
          }}
        >
          No location containers defined yet. All locations sit at World Root. Use
          "+ Add Container" above or convert a location node from the list below.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {orderedTree.map(({ container, indent }) => {
            const isExpanded = expandedContainerId === container.id;
            const descendantIds = getDescendantContainerIds(
              container.id,
              containers
            );
            const validParents = containers.filter(
              (c) => !descendantIds.has(c.id) && c.depth > container.depth
            );
            const directLocations = locations.filter(
              (l) => l.container_id === container.id
            );
            const l1Lore = container.lore_nodes ?? [];
            const hasInvalidLore =
              container.depth === 1 &&
              l1Lore.some(
                (ln) =>
                  !ln.title.trim() ||
                  !ln.content.trim() ||
                  !ln.entity_tags ||
                  ln.entity_tags.length === 0
              );

            return (
              <div
                key={container.id}
                id={`container-node-${container.id}`}
                style={{
                  marginLeft: indent * 18,
                  background: "var(--bg-card)",
                  border:
                    !container.name.trim() || hasInvalidLore
                      ? "1px solid rgba(244, 63, 94, 0.55)"
                      : "1px solid var(--border-subtle)",
                  borderRadius: 8,
                  padding: "9px 12px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {/* Header Summary Row */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    cursor: "pointer",
                  }}
                  onClick={() =>
                    setExpandedContainerId(isExpanded ? null : container.id)
                  }
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                    <span
                      className="badge"
                      style={{
                        fontSize: "0.66rem",
                        padding: "1px 6px",
                        color: "var(--accent-cyan)",
                        borderColor: "rgba(6, 182, 212, 0.45)",
                      }}
                    >
                      L{container.depth}
                    </span>
                    <FolderOpen size={14} color="var(--accent-cyan)" />
                    <strong
                      style={{
                        fontSize: "0.84rem",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {container.name || "Untitled Container"}
                    </strong>
                    <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                      · {directLocations.length} room
                      {directLocations.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="item-remove-btn"
                    title={`Delete container "${container.name}"`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openDeleteContainer(container);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                {isExpanded && (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 9,
                      borderTop: "1px solid var(--border-subtle)",
                      paddingTop: 9,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 145px 1fr",
                        gap: 8,
                      }}
                    >
                      <div className="field-group">
                        <label style={{ fontSize: "0.71rem" }}>Name</label>
                        <input
                          className="field-input"
                          value={container.name}
                          onChange={(e) =>
                            updateContainer(container.id, {
                              name: e.target.value,
                            })
                          }
                        />
                      </div>
                      <div className="field-group">
                        <label style={{ fontSize: "0.71rem" }}>Depth Level</label>
                        <select
                          className="field-select"
                          value={container.depth}
                          onChange={(e) =>
                            updateContainer(container.id, {
                              depth: Number(e.target.value) as 1 | 2 | 3 | 4,
                            })
                          }
                        >
                          <option value={4}>L4 · Region/Realm</option>
                          <option value={3}>L3 · City</option>
                          <option value={2}>L2 · District/Zone</option>
                          <option value={1}>L1 · Building/Site</option>
                        </select>
                      </div>
                      <div className="field-group">
                        <label style={{ fontSize: "0.71rem" }}>
                          Parent Container (cycle-safe)
                        </label>
                        <select
                          className="field-select"
                          value={container.parent_container_id ?? ""}
                          onChange={(e) =>
                            updateContainer(container.id, {
                              parent_container_id: e.target.value || null,
                            })
                          }
                        >
                          <option value="">World Root (Top Level)</option>
                          {validParents.map((vp) => (
                            <option key={vp.id} value={vp.id}>
                              {vp.name} (L{vp.depth})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="field-group">
                      <label style={{ fontSize: "0.71rem" }}>
                        Atmospheric Description
                      </label>
                      <textarea
                        className="field-textarea"
                        rows={2}
                        placeholder="Sensory overview and environmental flavor for breadcrumbs & scene arrival..."
                        value={container.description}
                        onChange={(e) =>
                          updateContainer(container.id, {
                            description: e.target.value,
                          })
                        }
                      />
                    </div>

                    <div className="field-group">
                      <label style={{ fontSize: "0.71rem" }}>
                        Environmental Tags
                      </label>
                      <TagChipsInput
                        value={container.environmental_tags || []}
                        placeholder="e.g. humid, noisy, industrial..."
                        accentVariant="cyan"
                        onChange={(tags) =>
                          updateContainer(container.id, {
                            environmental_tags: tags,
                          })
                        }
                      />
                    </div>

                    {/* Level 1 Lore Section (Strictly forbidden on L2-L4) */}
                    {container.depth === 1 ? (
                      <div
                        style={{
                          background: "var(--bg-panel)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 6,
                          padding: "8px 10px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 7,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                          }}
                        >
                          <span
                            className="cog-step-label"
                            style={{
                              marginBottom: 0,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                            }}
                          >
                            <BookOpen size={12} color="var(--accent-cyan)" />
                            Level 1 Container Lore &amp; Secrets ({l1Lore.length})
                          </span>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: "2px 8px", fontSize: "0.71rem" }}
                            onClick={() => {
                              const lid = `new_cl_${Date.now()}_${Math.random()
                                .toString(36)
                                .slice(2, 5)}`;
                              updateContainer(container.id, {
                                lore_nodes: [
                                  ...l1Lore,
                                  {
                                    id: lid,
                                    world_id: worldId,
                                    container_id: container.id,
                                    title: "",
                                    category: "rumor",
                                    content: "",
                                    entity_tags: [],
                                  },
                                ],
                              });
                              setExpandedLoreIds((prev) =>
                                new Set(prev).add(lid)
                              );
                            }}
                          >
                            <Plus size={11} /> Add Lore
                          </button>
                        </div>

                        {l1Lore.length === 0 ? (
                          <div
                            style={{
                              fontSize: "0.71rem",
                              color: "var(--text-muted)",
                              fontStyle: "italic",
                            }}
                          >
                            No building-wide lore attached yet.
                          </div>
                        ) : (
                          l1Lore.map((ln, idx) => {
                            const key = ln.id || `cl_${idx}`;
                            const open = expandedLoreIds.has(key);
                            const invalid =
                              !ln.title.trim() ||
                              !ln.content.trim() ||
                              !ln.entity_tags?.length;
                            return (
                              <div
                                key={key}
                                style={{
                                  border: invalid
                                    ? "1px solid rgba(244, 63, 94, 0.55)"
                                    : "1px solid var(--border-subtle)",
                                  borderRadius: 6,
                                  padding: "6px 8px",
                                  background: "var(--bg-card)",
                                  display: "flex",
                                  flexDirection: "column",
                                  gap: 6,
                                }}
                              >
                                <div
                                  style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    cursor: "pointer",
                                    gap: 6,
                                  }}
                                  onClick={() =>
                                    setExpandedLoreIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(key)) next.delete(key);
                                      else next.add(key);
                                      return next;
                                    })
                                  }
                                >
                                  <span
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 5,
                                      fontSize: "0.75rem",
                                      fontWeight: 600,
                                    }}
                                  >
                                    <span
                                      className={`lore-cat-badge lore-cat-badge--${ln.category}`}
                                    >
                                      {ln.category === "secret" && (
                                        <EyeOff size={10} />
                                      )}
                                      {ln.category}
                                    </span>
                                    {ln.title || "Untitled Lore"}
                                    {invalid && (
                                      <AlertCircle size={12} color="#fda4af" />
                                    )}
                                  </span>
                                  <button
                                    type="button"
                                    className="item-remove-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateContainer(container.id, {
                                        lore_nodes: l1Lore.filter(
                                          (_, i) => i !== idx
                                        ),
                                      });
                                    }}
                                  >
                                    <Trash2 size={11} />
                                  </button>
                                </div>

                                {open && (
                                  <div
                                    style={{
                                      display: "flex",
                                      flexDirection: "column",
                                      gap: 6,
                                      paddingTop: 4,
                                      borderTop: "1px solid var(--border-subtle)",
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "grid",
                                        gridTemplateColumns: "1fr 110px",
                                        gap: 6,
                                      }}
                                    >
                                      <input
                                        className="field-input"
                                        placeholder="Lore title"
                                        value={ln.title}
                                        onChange={(e) =>
                                          updateContainer(container.id, {
                                            lore_nodes: l1Lore.map((x, i) =>
                                              i === idx
                                                ? { ...x, title: e.target.value }
                                                : x
                                            ),
                                          })
                                        }
                                      />
                                      <select
                                        className="field-select"
                                        value={ln.category}
                                        onChange={(e) =>
                                          updateContainer(container.id, {
                                            lore_nodes: l1Lore.map((x, i) =>
                                              i === idx
                                                ? {
                                                    ...x,
                                                    category: e.target
                                                      .value as LocationLoreCategory,
                                                  }
                                                : x
                                            ),
                                          })
                                        }
                                      >
                                        {LOCATION_LORE_CATEGORIES.map((cat) => (
                                          <option key={cat} value={cat}>
                                            {cat === "secret"
                                              ? "🔒 secret"
                                              : cat}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <textarea
                                      className="field-textarea"
                                      rows={2}
                                      placeholder="Lore details..."
                                      value={ln.content}
                                      onChange={(e) =>
                                        updateContainer(container.id, {
                                          lore_nodes: l1Lore.map((x, i) =>
                                            i === idx
                                              ? { ...x, content: e.target.value }
                                              : x
                                          ),
                                        })
                                      }
                                    />
                                    <TagChipsInput
                                      value={ln.entity_tags || []}
                                      placeholder="Trigger keywords (min 1)..."
                                      accentVariant={
                                        ln.category === "secret"
                                          ? "amber"
                                          : "cyan"
                                      }
                                      onChange={(tags) =>
                                        updateContainer(container.id, {
                                          lore_nodes: l1Lore.map((x, i) =>
                                            i === idx
                                              ? { ...x, entity_tags: tags }
                                              : x
                                          ),
                                        })
                                      }
                                    />
                                  </div>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : (
                      <div
                        style={{
                          fontSize: "0.71rem",
                          color: "var(--text-muted)",
                          fontStyle: "italic",
                        }}
                      >
                        Level {container.depth} macro containers store hierarchy
                        &amp; ambiance only (lore nodes belong on Level 1
                        buildings/landmarks).
                      </div>
                    )}

                    {/* Direct Member Level 0 Locations */}
                    {directLocations.length > 0 && (
                      <div
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 5,
                          paddingTop: 4,
                        }}
                      >
                        <div className="cog-step-label" style={{ marginBottom: 0 }}>
                          Assigned Locations ({directLocations.length})
                        </div>
                        {directLocations.map((loc) => (
                          <div
                            key={loc.id}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 8,
                              background: "var(--bg-panel)",
                              padding: "5px 8px",
                              borderRadius: 5,
                              fontSize: "0.75rem",
                            }}
                          >
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 5,
                              }}
                            >
                              <MapPin size={12} color="var(--accent-cyan)" />
                              {loc.name}
                              {loc.is_entry_exit && (
                                <span
                                  className="badge"
                                  style={{
                                    fontSize: "0.62rem",
                                    color: "var(--accent-cyan)",
                                  }}
                                >
                                  <DoorOpen size={9} /> Entry/Exit Portal
                                </span>
                              )}
                            </span>

                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                              }}
                            >
                              <select
                                className="field-select"
                                aria-label={`Move ${loc.name} to container`}
                                style={{ fontSize: "0.7rem", padding: "2px 6px" }}
                                value={loc.container_id ?? ""}
                                onChange={(e) =>
                                  moveLocationToContainer(
                                    loc.id,
                                    e.target.value || null
                                  )
                                }
                              >
                                <option value="">Uncontained (Root)</option>
                                {containers.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.name} (L{c.depth})
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="btn"
                                style={{
                                  padding: "2px 7px",
                                  fontSize: "0.69rem",
                                  color: "var(--accent-amber)",
                                }}
                                onClick={() => onOpenConvertModal(loc)}
                              >
                                Convert to Container
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Uncontained Root Locations with quick Assign & Convert */}
      {uncontainedLocations.length > 0 && (
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            padding: "10px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div className="cog-step-label" style={{ marginBottom: 2 }}>
            Uncontained / World Root Locations ({uncontainedLocations.length})
          </div>
          {uncontainedLocations.map((loc) => (
            <div
              key={loc.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
                background: "var(--bg-panel)",
                padding: "6px 9px",
                borderRadius: 6,
                fontSize: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
              >
                <MapPin size={12} color="var(--accent-cyan)" />
                <strong>{loc.name}</strong>
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <ArrowRightLeft size={11} color="var(--text-muted)" />
                <select
                  className="field-select"
                  aria-label={`Assign ${loc.name} to container`}
                  style={{ fontSize: "0.71rem", padding: "2px 6px" }}
                  value=""
                  onChange={(e) =>
                    moveLocationToContainer(loc.id, e.target.value || null)
                  }
                >
                  <option value="">World Root (Uncontained)</option>
                  {containers.map((c) => (
                    <option key={c.id} value={c.id}>
                      Move to {c.name} (L{c.depth})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  style={{
                    padding: "2px 7px",
                    fontSize: "0.69rem",
                    color: "var(--accent-amber)",
                  }}
                  onClick={() => onOpenConvertModal(loc)}
                >
                  Convert to Container
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div ref={listBottomRef} />

      {/* Container Deletion Confirmation Modal */}
      {deleteModal && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 80 }}
          onClick={() => setDeleteModal(null)}
        >
          <div
            className="modal-panel"
            style={{ width: "min(480px, 92vw)" }}
            role="dialog"
            aria-modal="true"
            aria-label="Delete Container Confirmation"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span style={{ color: "#fda4af", fontWeight: 700 }}>
                Delete Container "{deleteModal.container.name}"?
              </span>
            </div>
            <div
              className="modal-body"
              style={{ display: "flex", flexDirection: "column", gap: 10 }}
            >
              {(deleteModal.childContainers.length > 0 ||
                deleteModal.childLocations.length > 0) && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: "0.78rem",
                  }}
                >
                  <div>
                    This container holds{" "}
                    <strong>{deleteModal.childContainers.length}</strong> child
                    containers and{" "}
                    <strong>{deleteModal.childLocations.length}</strong>{" "}
                    locations:
                  </div>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="radio"
                      checked={deleteModal.childHandling === "reassign"}
                      onChange={() =>
                        setDeleteModal({
                          ...deleteModal,
                          childHandling: "reassign",
                        })
                      }
                      disabled={
                        !containers.some(
                          (c) =>
                            c.id !== deleteModal.container.id &&
                            deleteModal.childContainers.every(
                              (cc) => cc.depth < c.depth
                            )
                        )
                      }
                    />
                    <span>Reassign children to another container:</span>
                  </label>
                  {deleteModal.childHandling === "reassign" && (
                    <select
                      className="field-select"
                      value={deleteModal.reassignTargetId}
                      onChange={(e) =>
                        setDeleteModal({
                          ...deleteModal,
                          reassignTargetId: e.target.value,
                        })
                      }
                    >
                      {containers
                        .filter(
                          (c) =>
                            c.id !== deleteModal.container.id &&
                            deleteModal.childContainers.every(
                              (cc) => cc.depth < c.depth
                            )
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} (L{c.depth})
                          </option>
                        ))}
                    </select>
                  )}
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="radio"
                      checked={deleteModal.childHandling === "unparent"}
                      onChange={() =>
                        setDeleteModal({
                          ...deleteModal,
                          childHandling: "unparent",
                        })
                      }
                    />
                    <span>Unparent children (move to World Root)</span>
                  </label>
                </div>
              )}

              {deleteModal.hasLevel1Lore && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    fontSize: "0.78rem",
                    borderTop: "1px solid var(--border-subtle)",
                    paddingTop: 8,
                  }}
                >
                  <div>
                    This Level 1 container has{" "}
                    <strong>{deleteModal.container.lore_nodes?.length}</strong>{" "}
                    lore entry/entries:
                  </div>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="radio"
                      checked={deleteModal.loreDisposal === "delete"}
                      onChange={() =>
                        setDeleteModal({
                          ...deleteModal,
                          loreDisposal: "delete",
                        })
                      }
                    />
                    <span>Delete container lore permanently</span>
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="radio"
                      checked={deleteModal.loreDisposal === "promote_to_world"}
                      onChange={() =>
                        setDeleteModal({
                          ...deleteModal,
                          loreDisposal: "promote_to_world",
                        })
                      }
                    />
                    <span>Promote entries to World Lore</span>
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="radio"
                      checked={deleteModal.loreDisposal === "reassign"}
                      disabled={
                        !containers.some(
                          (c) =>
                            c.id !== deleteModal.container.id && c.depth === 1
                        )
                      }
                      onChange={() =>
                        setDeleteModal({
                          ...deleteModal,
                          loreDisposal: "reassign",
                        })
                      }
                    />
                    <span>Reassign lore to another Level 1 container</span>
                  </label>
                  {deleteModal.loreDisposal === "reassign" && (
                    <select
                      className="field-select"
                      value={deleteModal.loreTargetId}
                      onChange={(e) =>
                        setDeleteModal({
                          ...deleteModal,
                          loreTargetId: e.target.value,
                        })
                      }
                    >
                      {containers
                        .filter(
                          (c) =>
                            c.id !== deleteModal.container.id && c.depth === 1
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} (L1)
                          </option>
                        ))}
                    </select>
                  )}
                </div>
              )}
            </div>
            <div
              className="modal-footer"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                padding: "10px 16px",
              }}
            >
              <button
                type="button"
                className="btn"
                onClick={() => setDeleteModal(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-rose"
                onClick={confirmDeleteContainer}
              >
                Confirm Delete Container
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
