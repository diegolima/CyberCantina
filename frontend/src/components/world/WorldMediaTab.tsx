import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  Check,
  Film,
  Image as ImageIcon,
  Maximize2,
  Pencil,
  Star,
} from "lucide-react";
import { api } from "../../api";
import type {
  AppSettings,
  LocationContainer,
  LocationNode,
  WorldMediaItem,
  WorldRecord,
} from "../../types";
import { ImageLightboxModal } from "../shared/ImageLightboxModal";
import {
  CardMediaActionStrip,
  MediaUploadFormatHint,
  UnifiedMediaUploadButton,
  buildImageDeleteConfirmMessage,
  uploadUnifiedMediaBatch,
} from "../shared/VideoUploadControls";

export interface WorldMediaTabProps {
  isActive: boolean;
  mode: "inspector" | "wizard" | "campaign";
  worldId: string;
  media: WorldMediaItem[];
  containers: LocationContainer[];
  locations: LocationNode[];
  isDirty: boolean;
  appSettings?: AppSettings | null;
  isAdmin?: boolean;
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
  appSettings = null,
  isAdmin = false,
  onWorldMutated,
}) => {
  const [uploading, setUploading] = useState(false);
  const [busyMediaId, setBusyMediaId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [brokenIds, setBrokenIds] = useState<Record<string, boolean>>({});

  const allowImageUploads = isAdmin || (appSettings?.allow_image_uploads ?? true);
  const allowVideoUploads = isAdmin || (appSettings?.allow_video_uploads ?? true);
  const maxVideoUploadMb = appSettings?.max_video_upload_mb ?? 15;

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

  const ensureNotDirtyForMediaMutation = (): boolean => {
    if (isDirty) {
      setMediaError("Please save or discard pending world edits before uploading new media.");
      return false;
    }
    return true;
  };

  const handleUploadFiles = async (files: File[]) => {
    if (files.length === 0 || isReadOnly || !ensureNotDirtyForMediaMutation()) return;
    setUploading(true);
    setMediaError(null);
    let currentWorldId = worldId;
    const ok = await uploadUnifiedMediaBatch<WorldRecord>({
      files,
      allowImageUploads,
      allowVideoUploads,
      label: labelInput,
      uploadImage: async (file, singleLabel) => {
        const updated = await api.uploadWorldMedia(currentWorldId, file, singleLabel);
        currentWorldId = updated.id;
        return updated;
      },
      uploadVideo: async (file, singleLabel) => {
        const updated = await api.uploadWorldMediaVideo(
          currentWorldId,
          file,
          singleLabel,
          null
        );
        currentWorldId = updated.id;
        return updated;
      },
      onSuccess: (latest) => {
        onWorldMutated(latest);
      },
      onError: (msg) => setMediaError(msg),
    });
    if (ok) {
      setLabelInput("");
    }
    setUploading(false);
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
      const isPublic = Boolean(item.is_public ?? impact.is_public);
      const linkedCount = linkCountsByMediaId[item.id] ?? 0;
      const msg = buildImageDeleteConfirmMessage({
        itemLabel: item.label || "World Image",
        isPublic,
        campaignsUsing: activeCamps,
        hasLinkedVideo: Boolean(impact.has_linked_video ?? item.video_url),
        linkedWorldCount: linkedCount,
      });
      if (!window.confirm(msg)) {
        setBusyMediaId(null);
        return;
      }
      const updated = await api.deleteWorldMedia(worldId, item.id);
      setLightboxIndex(null);
      onWorldMutated(updated, item.id);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to delete world media.");
    } finally {
      setBusyMediaId(null);
    }
  };

  const handleAttachOrReplaceVideo = async (item: WorldMediaItem, file: File) => {
    if (isReadOnly || !ensureNotDirtyForMediaMutation()) return;
    setBusyMediaId(item.id);
    setMediaError(null);
    try {
      const updated = await api.uploadWorldMediaVideo(
        worldId,
        file,
        item.label || undefined,
        item.id
      );
      onWorldMutated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to upload linked video.");
    } finally {
      setBusyMediaId(null);
    }
  };

  const handleDeleteVideo = async (item: WorldMediaItem) => {
    if (isReadOnly || !item.video_url) return;
    if (
      !window.confirm(
        `Remove the linked video from "${item.label || "World Image"}"?\n\nThe still image will be preserved and freed video storage will be reclaimed immediately.`
      )
    ) {
      return;
    }
    setBusyMediaId(item.id);
    setMediaError(null);
    try {
      const updated = await api.deleteWorldMediaVideo(worldId, item.id);
      onWorldMutated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to remove linked video.");
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
                placeholder="Optional label (defaults to filename)..."
                value={labelInput}
                disabled={uploading}
                onChange={(e) => setLabelInput(e.target.value)}
                style={{ fontSize: "0.8rem" }}
              />
              <UnifiedMediaUploadButton
                uploading={uploading}
                allowImageUploads={allowImageUploads}
                allowVideoUploads={allowVideoUploads}
                maxVideoUploadMb={maxVideoUploadMb}
                btnClassName="btn btn-sm btn-cyan"
                onBeforePick={ensureNotDirtyForMediaMutation}
                onUploadFiles={handleUploadFiles}
              />
            </div>
            <MediaUploadFormatHint
              allowImageUploads={allowImageUploads}
              allowVideoUploads={allowVideoUploads}
              maxVideoUploadMb={maxVideoUploadMb}
              extraNote="First image appears on the Home screen Worlds card."
            />
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
                    onClick={() => setLightboxIndex(idx)}
                    title={item.video_url ? "Click to enlarge and play video" : "Click to enlarge"}
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
                    {item.video_url && (
                      <span
                        className="badge"
                        title="Image-linked video"
                        style={{
                          position: "absolute",
                          bottom: 6,
                          left: 6,
                          fontSize: "0.62rem",
                          background: "rgba(15, 23, 42, 0.86)",
                          color: "#e2e8f0",
                          borderColor: "var(--border-subtle)",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <Film size={9} /> Video
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
                      <span>
                        {formatByteSize(item.byte_size)}
                        {item.video_byte_size ? ` + ${formatByteSize(item.video_byte_size)} vid` : ""}
                      </span>
                      <span>
                        {linkedCount > 0
                          ? `Linked to ${linkedCount}`
                          : "Unlinked"}
                      </span>
                    </div>

                    {!isReadOnly && (
                      <div style={{ paddingTop: 2 }}>
                        <CardMediaActionStrip
                          itemLabel={item.label || "World Image"}
                          isPublic={Boolean(item.is_public)}
                          hasVideo={Boolean(item.video_url)}
                          busy={isBusy}
                          allowVideoUploads={allowVideoUploads}
                          maxVideoUploadMb={maxVideoUploadMb}
                          leadingSlot={
                            !isPrimary ? (
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{ fontSize: "0.7rem", padding: "3px 6px" }}
                                disabled={isBusy}
                                onClick={() => handleSetPrimary(item.id)}
                                title="Use as primary cover image on Home screen"
                              >
                                <Star size={11} /> Set Primary
                              </button>
                            ) : undefined
                          }
                          onBeforePickVideo={ensureNotDirtyForMediaMutation}
                          onAttachOrReplaceVideo={(file) =>
                            handleAttachOrReplaceVideo(item, file)
                          }
                          onRemoveVideo={() => handleDeleteVideo(item)}
                          onDeleteImage={() => handleDelete(item)}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {lightboxIndex !== null && imageItems[lightboxIndex] && (
        <ImageLightboxModal
          url={imageItems[lightboxIndex].url}
          videoUrl={imageItems[lightboxIndex].video_url}
          videoMimeType={imageItems[lightboxIndex].video_mime_type}
          autoPlayVideo={false}
          label={imageItems[lightboxIndex].label || "World Image"}
          counterText={
            imageItems.length > 1
              ? `${lightboxIndex + 1} / ${imageItems.length}`
              : undefined
          }
          onPrev={
            imageItems.length > 1
              ? () =>
                  setLightboxIndex(
                    (prev) => ((prev ?? 0) - 1 + imageItems.length) % imageItems.length
                  )
              : undefined
          }
          onNext={
            imageItems.length > 1
              ? () =>
                  setLightboxIndex((prev) => ((prev ?? 0) + 1) % imageItems.length)
              : undefined
          }
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
};
