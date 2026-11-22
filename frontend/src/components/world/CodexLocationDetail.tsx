import React, { useEffect, useState } from "react";
import { Compass, Film, Layers, MapPin, Maximize2 } from "lucide-react";
import type { LocationContainer, LocationNode } from "../../types";
import {
  CONTAINER_DEPTH_LABELS,
  buildContainerBreadcrumbChain,
} from "../map/topologyProjection";
import {
  getLoreCategoryLabel,
  getVisibleScopedLore,
  isCodexContainerImageVisible,
  isCodexLocationImageVisible,
} from "./codexHelpers";

interface CodexLocationDetailProps {
  kind: "location" | "container";
  location?: LocationNode | null;
  container?: LocationContainer | null;
  containers: readonly LocationContainer[];
  locations: readonly LocationNode[];
  visitedContainerIds: readonly string[];
  activeLocationId?: string;
  isCampaignMode: boolean;
  onOpenOnMap: (kind: "location" | "container", id: string) => void;
  onEnlargeImage: (
    url: string,
    label: string,
    videoUrl?: string | null,
    videoMimeType?: string | null
  ) => void;
}

export const CodexLocationDetail: React.FC<CodexLocationDetailProps> = ({
  kind,
  location,
  container,
  containers,
  locations,
  visitedContainerIds,
  activeLocationId,
  isCampaignMode,
  onOpenOnMap,
  onEnlargeImage,
}) => {
  const [brokenUrls, setBrokenUrls] = useState<Record<string, boolean>>({});
  const targetId = kind === "location" ? location?.id : container?.id;

  useEffect(() => {
    setBrokenUrls({});
  }, [targetId]);

  if (kind === "location" && location) {
    const breadcrumb = buildContainerBreadcrumbChain(
      location.container_id,
      containers as LocationContainer[]
    );
    const localLore = getVisibleScopedLore(location.lore_nodes, isCampaignMode);
    const showImage =
      isCodexLocationImageVisible(location, isCampaignMode) &&
      Boolean(location.image_url) &&
      !brokenUrls[location.image_url ?? ""];
    const isCurrent = Boolean(activeLocationId && location.id === activeLocationId);

    return (
      <div className="codex-detail-stack">
        <div className="codex-detail-header">
          <div style={{ minWidth: 0 }}>
            {breadcrumb.length > 0 && (
              <div className="codex-breadcrumb-trail">
                {breadcrumb.map((c) => c.name).join(" › ")}
              </div>
            )}
            <div className="codex-detail-title-row">
              <MapPin size={15} color="var(--accent-cyan)" />
              <h3 className="codex-detail-title">{location.name}</h3>
            </div>
            <div className="codex-badge-row">
              <span className="badge codex-badge--location">Location</span>
              {location.is_starting_location && (
                <span className="badge codex-badge--emerald">Start</span>
              )}
              {location.is_hub && (
                <span className="badge codex-badge--violet">Hub</span>
              )}
              {isCurrent && (
                <span className="badge codex-badge--amber">Current</span>
              )}
              {isCampaignMode && (
                <span
                  className={`badge ${
                    location.is_visited ? "codex-badge--amber" : "codex-badge--muted"
                  }`}
                >
                  {location.is_visited ? "Visited" : "Unvisited"}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onOpenOnMap("location", location.id)}
            title="Switch to Map tab focused on this location"
          >
            <Compass size={13} /> Open on Map →
          </button>
        </div>

        {showImage && location.image_url && (
          <div
            className="codex-media-preview"
            onClick={() =>
              onEnlargeImage(
                location.image_url!,
                (location.image_label || "").trim() || location.name,
                location.video_url,
                location.video_mime_type
              )
            }
            title={location.video_url ? "Click to enlarge and play video" : "Click to enlarge"}
          >
            <img
              src={location.image_url}
              alt={(location.image_label || "").trim() || location.name}
              onError={() =>
                setBrokenUrls((prev) => ({ ...prev, [location.image_url!]: true }))
              }
            />
            {location.video_url && (
              <span
                style={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  background: "rgba(15, 23, 42, 0.85)",
                  color: "#e2e8f0",
                  borderRadius: 4,
                  padding: "2px 6px",
                  fontSize: "0.68rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Film size={11} /> Video
              </span>
            )}
            <span className="codex-media-zoom-pill">
              <Maximize2 size={11} /> Enlarge
            </span>
          </div>
        )}

        {location.summary.trim() && (
          <div className="codex-section-card">
            <div className="codex-section-label">Summary</div>
            <p className="codex-prose-text">{location.summary}</p>
          </div>
        )}

        <div className="codex-section-card">
          <div className="codex-section-label">Description</div>
          <p className="codex-prose-text">
            {location.description.trim() || "No description provided."}
          </p>
        </div>

        {location.environmental_tags.length > 0 && (
          <div className="codex-section-card">
            <div className="codex-section-label">Environmental Tags</div>
            <div className="codex-chip-list">
              {location.environmental_tags.map((tag) => (
                <span key={tag} className="badge codex-tag-chip">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="codex-section-card">
          <div className="codex-section-label">
            Local Lore ({localLore.length})
          </div>
          {localLore.length === 0 ? (
            <div className="codex-muted-note">
              No local lore entries visible for this location.
            </div>
          ) : (
            <div className="codex-local-lore-list">
              {localLore.map((ln) => (
                <div key={ln.id} className="codex-local-lore-item">
                  <div className="codex-local-lore-head">
                    <strong>{ln.title}</strong>
                    <span className={`lore-cat-badge lore-cat-badge--${ln.category}`}>
                      {getLoreCategoryLabel(ln.category)}
                    </span>
                  </div>
                  <p className="codex-prose-text">{ln.content}</p>
                  {ln.entity_tags.length > 0 && (
                    <div className="codex-chip-list">
                      {ln.entity_tags.map((tag) => (
                        <span key={tag} className="badge codex-tag-chip">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (kind === "container" && container) {
    const breadcrumb = buildContainerBreadcrumbChain(
      container.parent_container_id,
      containers as LocationContainer[]
    );
    const depthLabel =
      CONTAINER_DEPTH_LABELS[container.depth] ?? `Level ${container.depth}`;
    const localLore =
      container.depth === 1
        ? getVisibleScopedLore(container.lore_nodes, isCampaignMode)
        : [];
    const childContCount = containers.filter(
      (c) => c.parent_container_id === container.id
    ).length;
    const directLocCount = locations.filter(
      (l) => l.container_id === container.id
    ).length;
    const showImage =
      isCodexContainerImageVisible(
        container,
        containers,
        locations,
        visitedContainerIds,
        isCampaignMode
      ) &&
      Boolean(container.image_url) &&
      !brokenUrls[container.image_url ?? ""];

    return (
      <div className="codex-detail-stack">
        <div className="codex-detail-header">
          <div style={{ minWidth: 0 }}>
            {breadcrumb.length > 0 && (
              <div className="codex-breadcrumb-trail">
                {breadcrumb.map((c) => c.name).join(" › ")}
              </div>
            )}
            <div className="codex-detail-title-row">
              <Layers size={15} color="var(--accent-cyan)" />
              <h3 className="codex-detail-title">{container.name}</h3>
            </div>
            <div className="codex-badge-row">
              <span className="badge codex-badge--location">
                L{container.depth} · {depthLabel}
              </span>
              <span className="badge codex-badge--muted">
                {directLocCount} {directLocCount === 1 ? "site" : "sites"}
                {childContCount > 0
                  ? ` · ${childContCount} ${childContCount === 1 ? "sub-area" : "sub-areas"}`
                  : ""}
              </span>
            </div>
          </div>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onOpenOnMap("container", container.id)}
            title="Switch to Map tab focused on this container"
          >
            <Compass size={13} /> Open on Map →
          </button>
        </div>

        {showImage && container.image_url && (
          <div
            className="codex-media-preview"
            onClick={() =>
              onEnlargeImage(
                container.image_url!,
                (container.image_label || "").trim() || container.name,
                container.video_url,
                container.video_mime_type
              )
            }
            title={container.video_url ? "Click to enlarge and play video" : "Click to enlarge"}
          >
            <img
              src={container.image_url}
              alt={(container.image_label || "").trim() || container.name}
              onError={() =>
                setBrokenUrls((prev) => ({ ...prev, [container.image_url!]: true }))
              }
            />
            {container.video_url && (
              <span
                style={{
                  position: "absolute",
                  top: 8,
                  left: 8,
                  background: "rgba(15, 23, 42, 0.85)",
                  color: "#e2e8f0",
                  borderRadius: 4,
                  padding: "2px 6px",
                  fontSize: "0.68rem",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <Film size={11} /> Video
              </span>
            )}
            <span className="codex-media-zoom-pill">
              <Maximize2 size={11} /> Enlarge
            </span>
          </div>
        )}

        <div className="codex-section-card">
          <div className="codex-section-label">Description</div>
          <p className="codex-prose-text">
            {container.description.trim() || "No description provided."}
          </p>
        </div>

        {container.environmental_tags.length > 0 && (
          <div className="codex-section-card">
            <div className="codex-section-label">Environmental Tags</div>
            <div className="codex-chip-list">
              {container.environmental_tags.map((tag) => (
                <span key={tag} className="badge codex-tag-chip">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {container.depth === 1 && (
          <div className="codex-section-card">
            <div className="codex-section-label">
              Area Lore ({localLore.length})
            </div>
            {localLore.length === 0 ? (
              <div className="codex-muted-note">
                No area lore entries visible for this container.
              </div>
            ) : (
              <div className="codex-local-lore-list">
                {localLore.map((ln) => (
                  <div key={ln.id} className="codex-local-lore-item">
                    <div className="codex-local-lore-head">
                      <strong>{ln.title}</strong>
                      <span className={`lore-cat-badge lore-cat-badge--${ln.category}`}>
                        {getLoreCategoryLabel(ln.category)}
                      </span>
                    </div>
                    <p className="codex-prose-text">{ln.content}</p>
                    {ln.entity_tags.length > 0 && (
                      <div className="codex-chip-list">
                        {ln.entity_tags.map((tag) => (
                          <span key={tag} className="badge codex-tag-chip">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="ui-empty-state ui-empty-state--fill">
      Select a region, area, or location on the left to inspect its details.
    </div>
  );
};
