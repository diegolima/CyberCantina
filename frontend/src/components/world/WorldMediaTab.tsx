import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  Pencil,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../../api";
import type {
  LocationContainer,
  LocationNode,
  WorldMediaItem,
  WorldRecord,
} from "../../types";
import { ImageLightboxModal } from "../shared/ImageLightboxModal";

export interface WorldMediaTabProps {
  isActive: boolean;
  mode: "inspector" | "wizard" | "campaign";
  worldId: string;
  media: WorldMediaItem[];
  containers: LocationContainer[];
  locations: LocationNode[];
  isDirty: boolean;
  onWorldMutated: (updated: WorldRecord, deletedMediaId?: string) => void;
}

function formatByteSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const WorldMediaTab: React.FC<WorldMediaTabProps> = ({
  isActive,
  mode,
  worldId,
  media,
  containers,
  locations,
  isDirty,
  onWorldMutated,
}) => {
  const [uploading, setUploading] = useState(false);
  const [busyMediaId, setBusyMediaId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);
  const [brokenIds, setBrokenIds] = useState<Record<string, boolean>>({});

  const imageItems = useMemo(
    () => media.filter((m) => m.media_type === "image" && !brokenIds[m.id]),
    [media, brokenIds]
  );

  const linkCountsByMediaId = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of containers) {
      if (c.image_media_id) {
        counts[c.image_media_id] = (counts[c.image_media_id] ?? 0) + 1;
      }
    }
    for (const l of locations) {
      if (l.image_media_id) {
        counts[l.image_media_id] = (counts[l.image_media_id] ?? 0) + 1;
      }
    }
    return counts;
  }, [containers, locations]);

  const isReadOnly = mode !== "inspector";

  const handleUploadFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || isReadOnly) return;
    if (isDirty) {
      setMediaError("Please save or discard pending world edits before uploading new media.");
      e.target.value = "";
      return;
    }
    setUploading(true);
    setMediaError(null);
    try {
      let currentWorldId = worldId;
      let latest: WorldRecord | null = null;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const customLabel =
          files.length === 1 && labelInput.trim() ? labelInput.trim() : undefined;
        latest = await api.uploadWorldMedia(currentWorldId, file, customLabel);
        currentWorldId = latest.id;
      }
      if (latest) {
        setLabelInput("");
        onWorldMutated(latest);
      }
    } catch (err: any) {
      setMediaError(err?.message || "Failed to upload world image.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleSaveLabel = async (mediaId: string) => {
    if (isReadOnly) return;
    if (isDirty) {
      setMediaError("Please save or discard pending world edits before renaming media.");
      return;
    }
    setBusyMediaId(mediaId);
    setMediaError(null);
    try {
      const updated = await api.updateWorldMediaLabel(worldId, mediaId, editingLabel);
      setEditingId(null);
      onWorldMutated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to update image label.");
    } finally {
      setBusyMediaId(null);
    }
  };

  const handleSetPrimary = async (mediaId: string) => {
    if (isReadOnly) return;
    if (isDirty) {
      setMediaError("Please save or discard pending world edits before reordering media.");
      return;
    }
    const nextOrder = [mediaId, ...media.map((m) => m.id).filter((id) => id !== mediaId)];
    setBusyMediaId(mediaId);
    setMediaError(null);
    try {
      const updated = await api.reorderWorldMedia(worldId, nextOrder);
      onWorldMutated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to reorder world media.");
    } finally {
      setBusyMediaId(null);
    }
  };

  const handleDelete = async (item: WorldMediaItem) => {
    if (isReadOnly) return;
    setBusyMediaId(item.id);
    setMediaError(null);
    try {
      const impact = await api.getWorldMediaImpact(worldId, item.id);
      const activeCamps = impact.campaigns_using || 0;
      const linkedCount = linkCountsByMediaId[item.id] ?? 0;
      const warnLines = [
        `Delete "${item.label || "World Image"}" permanently?`,
        "This immediately deletes the file from disk to free storage quota.",
      ];
      if (linkedCount > 0) {
        warnLines.push(
          `It is currently linked to ${linkedCount} location/container(s) in this world.`
        );
      }
      if (activeCamps > 0) {
        warnLines.push(
          `WARNING: ${activeCamps} active campaign(s) reference this image and will no longer display it.`
        );
      }
      if (!window.confirm(warnLines.join("\n\n"))) {
        setBusyMediaId(null);
        return;
      }
      const updated = await api.deleteWorldMedia(worldId, item.id);
      if (lightbox?.url === item.url) {
        setLightbox(null);
      }
      onWorldMutated(updated, item.id);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to delete world media.");
    } finally {
      setBusyMediaId(null);
    }
  };

  return (
    <>
      <div
        style={{
          display: isActive ? "flex" : "none",
          flexDirection: "column",
          gap: 14,
        }}
      >
        {mode === "wizard" && (
          <div
            style={{
              padding: "12px 14px",
              borderRadius: 8,
              border: "1px solid rgba(6, 182, 212, 0.3)",
              background: "rgba(6, 182, 212, 0.08)",
              color: "#67e8f9",
              fontSize: "0.8rem",
              lineHeight: 1.45,
            }}
          >
            Save this world first to upload scene images and link them to locations or containers.
          </div>
        )}

        {mode === "campaign" && (
          <div
            style={{
              fontSize: "0.78rem",
              color: "var(--text-secondary)",
              lineHeight: 1.4,
            }}
          >
            World scene visuals frozen for this campaign. Edit or upload media in the main World Sheet.
          </div>
        )}

        {mode === "inspector" && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-card)",
            }}
          >
            <div style={{ display: "flex", flex: 1, minWidth: 220, gap: 8, alignItems: "center" }}>
              <input
                type="text"
                className="field-input"
                placeholder="Optional image label (defaults to filename)..."
                value={labelInput}
                disabled={uploading}
                onChange={(e) => setLabelInput(e.target.value)}
                style={{ fontSize: "0.8rem" }}
              />
              <label
                className={`btn btn-sm btn-cyan ${uploading ? "disabled" : ""}`}
                style={{ cursor: uploading ? "wait" : "pointer", whiteSpace: "nowrap" }}
              >
                {uploading ? <Loader2 size={13} className="spin-slow" /> : <Upload size={13} />}
                <span>{uploading ? "Uploading..." : "Upload Image(s)"}</span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  disabled={uploading}
                  onChange={handleUploadFiles}
                  style={{ display: "none" }}
                />
              </label>
            </div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
              First image appears on the Home screen Worlds card.
            </div>
          </div>
        )}

        {mediaError && (
          <div
            style={{
              color: "#fda4af",
              fontSize: "0.78rem",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <AlertCircle size={14} />
            <span>{mediaError}</span>
          </div>
        )}

        {imageItems.length === 0 ? (
          <div
            style={{
              padding: "28px 16px",
              borderRadius: 8,
              border: "1px dashed var(--border-subtle)",
              textAlign: "center",
              color: "var(--text-muted)",
              fontSize: "0.82rem",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <ImageIcon size={24} style={{ opacity: 0.55 }} />
            <span>No world images uploaded yet.</span>
          </div>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
              gap: 12,
            }}
          >
            {imageItems.map((item, idx) => {
              const linkedCount = linkCountsByMediaId[item.id] ?? 0;
              const isBusy = busyMediaId === item.id;
              const isPrimary = idx === 0;

              return (
                <div
                  key={item.id}
                  style={{
                    background: "var(--bg-card)",
                    border: isPrimary
                      ? "1px solid rgba(6, 182, 212, 0.55)"
                      : "1px solid var(--border-subtle)",
                    borderRadius: 8,
                    overflow: "hidden",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      height: 126,
                      background: "var(--bg-panel)",
                      cursor: "pointer",
                    }}
                    onClick={() =>
                      setLightbox({ url: item.url, label: item.label || "World Image" })
                    }
                    title="Click to enlarge"
                  >
                    <img
                      src={item.url}
                      alt={item.label || "World scene"}
                      loading="lazy"
                      onError={() =>
                        setBrokenIds((prev) => ({ ...prev, [item.id]: true }))
                      }
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                    <span
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        background: "rgba(15, 23, 42, 0.78)",
                        color: "#e2e8f0",
                        borderRadius: 4,
                        padding: "3px 5px",
                        display: "inline-flex",
                        alignItems: "center",
                      }}
                    >
                      <Maximize2 size={11} />
                    </span>
                    {isPrimary && (
                      <span
                        className="badge"
                        style={{
                          position: "absolute",
                          top: 6,
                          left: 6,
                          fontSize: "0.62rem",
                          background: "rgba(8, 47, 73, 0.88)",
                          color: "#67e8f9",
                          borderColor: "rgba(6, 182, 212, 0.55)",
                        }}
                      >
                        <Star size={9} style={{ marginRight: 3 }} /> Primary
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      padding: "8px 10px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 6,
                      flex: 1,
                    }}
                  >
                    {editingId === item.id ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <input
                          type="text"
                          className="field-input"
                          value={editingLabel}
                          onChange={(e) => setEditingLabel(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleSaveLabel(item.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          style={{ fontSize: "0.76rem", padding: "3px 6px" }}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="btn btn-sm btn-cyan"
                          disabled={isBusy}
                          onClick={() => handleSaveLabel(item.id)}
                          aria-label="Save label"
                          style={{ padding: "2px 6px" }}
                        >
                          <Check size={12} />
                        </button>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 6,
                        }}
                      >
                        <span
                          style={{
                            fontSize: "0.78rem",
                            fontWeight: 600,
                            color: "var(--text-primary)",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={item.label || "Untitled"}
                        >
                          {item.label || "Untitled"}
                        </span>
                        {!isReadOnly && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setEditingId(item.id);
                              setEditingLabel(item.label || "");
                            }}
                            title="Rename image"
                            style={{ padding: 2 }}
                          >
                            <Pencil size={11} />
                          </button>
                        )}
                      </div>
                    )}

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: "0.68rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      <span>{formatByteSize(item.byte_size)}</span>
                      <span>
                        {linkedCount > 0
                          ? `Linked to ${linkedCount}`
                          : "Unlinked"}
                      </span>
                    </div>

                    {!isReadOnly && (
                      <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 2 }}>
                        {!isPrimary && (
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ flex: 1, fontSize: "0.7rem", padding: "3px 6px" }}
                            disabled={isBusy}
                            onClick={() => handleSetPrimary(item.id)}
                            title="Use as primary cover image on Home screen"
                          >
                            <Star size={11} /> Set Primary
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-sm btn-danger"
                          style={{ fontSize: "0.7rem", padding: "3px 8px", marginLeft: "auto" }}
                          disabled={isBusy}
                          onClick={() => handleDelete(item)}
                          title="Delete image permanently"
                        >
                          {isBusy ? (
                            <Loader2 size={11} className="spin-slow" />
                          ) : (
                            <Trash2 size={11} />
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {lightbox && (
        <ImageLightboxModal
          url={lightbox.url}
          label={lightbox.label}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
};
