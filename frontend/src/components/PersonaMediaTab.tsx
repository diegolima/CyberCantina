import React, { useState } from "react";
import {
  Film,
  Image as ImageIcon,
  Info,
  Loader2,
  Maximize2,
  Trash2,
  Upload,
  UserCheck,
} from "lucide-react";
import { api } from "../api";
import type { AppSettings, GalleryImage, PersonaRecord } from "../types";
import { cropToSquareBlob } from "./character/characterMediaUtils";
import { ImageLightboxModal } from "./shared/ImageLightboxModal";
import {
  CardMediaActionStrip,
  MediaUploadFormatHint,
  UnifiedMediaUploadButton,
  buildImageDeleteConfirmMessage,
  uploadUnifiedMediaBatch,
} from "./shared/VideoUploadControls";

export interface PersonaMediaTabProps {
  isActive: boolean;
  personaId: string | null;
  isReadOnly: boolean;
  isUnsavedDraft: boolean;
  portraitUrl: string | null;
  gallery: GalleryImage[];
  appSettings?: AppSettings | null;
  isAdmin?: boolean;
  onMediaUpdated: (updated: PersonaRecord) => void;
}

export const PersonaMediaTab: React.FC<PersonaMediaTabProps> = ({
  isActive,
  personaId,
  isReadOnly,
  isUnsavedDraft,
  portraitUrl,
  gallery,
  appSettings = null,
  isAdmin = false,
  onMediaUpdated,
}) => {
  const [isUploadingPortrait, setIsUploadingPortrait] = useState(false);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);
  const [busyGalleryId, setBusyGalleryId] = useState<string | null>(null);
  const [galleryCaptionInput, setGalleryCaptionInput] = useState("");
  const [lightboxTarget, setLightboxTarget] = useState<
    { kind: "portrait"; url: string } | { kind: "gallery"; index: number } | null
  >(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const canMutate = Boolean(personaId) && !isReadOnly && !isUnsavedDraft;
  const allowImageUploads = isAdmin || (appSettings?.allow_image_uploads ?? true);
  const allowVideoUploads = isAdmin || (appSettings?.allow_video_uploads ?? true);
  const maxVideoUploadMb = appSettings?.max_video_upload_mb ?? 15;

  const handlePortraitUpload = async (file: File) => {
    if (!personaId || !canMutate) return;
    setIsUploadingPortrait(true);
    setMediaError(null);
    try {
      const blob = await cropToSquareBlob(file, 512);
      const updated = await api.uploadPersonaPortrait(personaId, blob);
      onMediaUpdated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to upload persona portrait.");
    } finally {
      setIsUploadingPortrait(false);
    }
  };

  const handlePortraitDelete = async () => {
    if (!personaId || !canMutate) return;
    if (!window.confirm("Remove this persona's primary portrait?")) return;
    setIsUploadingPortrait(true);
    setMediaError(null);
    try {
      const updated = await api.deletePersonaPortrait(personaId);
      if (lightboxTarget?.kind === "portrait") {
        setLightboxTarget(null);
      }
      onMediaUpdated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to remove persona portrait.");
    } finally {
      setIsUploadingPortrait(false);
    }
  };

  const handleUnifiedUpload = async (files: File[]) => {
    if (!personaId || !canMutate || files.length === 0) return;
    setIsUploadingGallery(true);
    setMediaError(null);
    const ok = await uploadUnifiedMediaBatch<PersonaRecord>({
      files,
      allowImageUploads,
      allowVideoUploads,
      label: galleryCaptionInput,
      uploadImage: (file, singleLabel) =>
        api.uploadPersonaGalleryImage(
          personaId,
          file,
          singleLabel ?? (galleryCaptionInput.trim() || undefined)
        ),
      uploadVideo: (file, singleLabel) =>
        api.uploadPersonaGalleryVideo(
          personaId,
          file,
          singleLabel ?? (galleryCaptionInput.trim() || undefined),
          null
        ),
      onSuccess: (latest) => {
        onMediaUpdated(latest);
      },
      onError: (msg) => setMediaError(msg),
    });
    if (ok) {
      setGalleryCaptionInput("");
    }
    setIsUploadingGallery(false);
  };

  const handleGalleryDelete = async (img: GalleryImage) => {
    if (!personaId || !canMutate) return;
    setBusyGalleryId(img.id);
    setMediaError(null);
    try {
      const impact = await api.getPersonaGalleryImpact(personaId, img.id);
      const msg = buildImageDeleteConfirmMessage({
        itemLabel: img.caption || "Persona Photo",
        isPublic: Boolean(img.is_public ?? impact.is_public),
        campaignsUsing: impact.campaigns_using || 0,
        hasLinkedVideo: Boolean(impact.has_linked_video ?? img.video_url),
      });
      if (!window.confirm(msg)) {
        setBusyGalleryId(null);
        return;
      }
      const updated = await api.deletePersonaGalleryImage(personaId, img.id);
      setLightboxTarget(null);
      onMediaUpdated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to delete photo.");
    } finally {
      setBusyGalleryId(null);
    }
  };

  const handleAttachOrReplaceVideo = async (img: GalleryImage, file: File) => {
    if (!personaId || !canMutate) return;
    setBusyGalleryId(img.id);
    setMediaError(null);
    try {
      const updated = await api.uploadPersonaGalleryVideo(
        personaId,
        file,
        img.caption || undefined,
        img.id
      );
      onMediaUpdated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to upload video to album.");
    } finally {
      setBusyGalleryId(null);
    }
  };

  const handleVideoDelete = async (img: GalleryImage) => {
    if (!personaId || !canMutate || !img.video_url) return;
    if (
      !window.confirm(
        `Remove the linked video from "${img.caption || "Persona Photo"}"?\n\nThe still image will be preserved.`
      )
    ) {
      return;
    }
    setBusyGalleryId(img.id);
    setMediaError(null);
    try {
      const updated = await api.deletePersonaGalleryVideo(personaId, img.id);
      onMediaUpdated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to remove linked video.");
    } finally {
      setBusyGalleryId(null);
    }
  };

  return (
    <>
      <div
        style={{
          display: isActive ? "flex" : "none",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {isUnsavedDraft && !isReadOnly && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              backgroundColor: "rgba(59, 130, 246, 0.08)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              fontSize: "0.82rem",
              lineHeight: 1.5,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Info size={15} color="#60a5fa" style={{ flexShrink: 0 }} />
            <span>
              Save this persona first to upload a primary portrait or photo album images.
            </span>
          </div>
        )}

        {isReadOnly && (
          <div
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              backgroundColor: "rgba(59, 130, 246, 0.08)",
              border: "1px solid rgba(59, 130, 246, 0.25)",
              fontSize: "0.82rem",
              lineHeight: 1.5,
            }}
          >
            The default <em>"User"</em> persona is read-only. Clone it as a new persona to attach custom media.
          </div>
        )}

        {mediaError && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 6,
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              border: "1px solid rgba(239, 68, 68, 0.4)",
              color: "#fda4af",
              fontSize: "0.8rem",
            }}
          >
            {mediaError}
          </div>
        )}

        {/* Primary Portrait Section */}
        <div
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 8,
            padding: 14,
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              position: "relative",
              width: 88,
              height: 88,
              borderRadius: "50%",
              overflow: "hidden",
              border: portraitUrl
                ? "2px solid var(--accent-emerald)"
                : "2px dashed var(--border-subtle)",
              background: "rgba(0, 0, 0, 0.4)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              cursor: portraitUrl ? "pointer" : "default",
            }}
            onClick={() => {
              if (portraitUrl) {
                setLightboxTarget({ kind: "portrait", url: portraitUrl });
              }
            }}
          >
            {portraitUrl ? (
              <img
                src={portraitUrl}
                alt="Persona Portrait"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <UserCheck size={32} style={{ color: "var(--accent-emerald)", opacity: 0.55 }} />
            )}

            {isUploadingPortrait && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "rgba(0,0,0,0.65)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Loader2 size={22} className="spin" style={{ color: "var(--accent-emerald)" }} />
              </div>
            )}
          </div>

          <div style={{ flex: 1, minWidth: 200, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: "0.84rem", fontWeight: 700, color: "var(--accent-emerald)" }}>
              Primary Portrait
            </div>
            <div style={{ fontSize: "0.76rem", color: "var(--text-secondary)", lineHeight: 1.4 }}>
              Square-cropped avatar displayed on Home cards, World Codex, campaign selection, and beside your turns in chat.
            </div>
            {canMutate && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <label
                  className={`btn btn-sm btn-emerald ${
                    isUploadingPortrait || !allowImageUploads ? "disabled" : ""
                  }`}
                  style={{
                    cursor: !allowImageUploads
                      ? "not-allowed"
                      : isUploadingPortrait
                      ? "wait"
                      : "pointer",
                    opacity: allowImageUploads ? 1 : 0.55,
                  }}
                  title={
                    allowImageUploads
                      ? undefined
                      : "Image uploads are currently disabled by the server administrator."
                  }
                >
                  <Upload size={12} />
                  <span>{portraitUrl ? "Replace Portrait" : "Upload Portrait"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={isUploadingPortrait || !allowImageUploads}
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handlePortraitUpload(file);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
                {portraitUrl && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={isUploadingPortrait}
                    style={{
                      color: "#f87171",
                      borderColor: "rgba(239, 68, 68, 0.3)",
                    }}
                    onClick={handlePortraitDelete}
                  >
                    <Trash2 size={12} />
                    <span>Remove</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Photo Album Section */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              background: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
              padding: "10px 14px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className="sidebar-label" style={{ margin: 0 }}>
                Photo Album ({gallery.length})
              </span>
              <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                Click thumbnail to inspect
              </span>
            </div>

            {canMutate && (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="text"
                  className="field-input"
                  placeholder="Optional caption..."
                  style={{ width: 170, padding: "4px 8px", fontSize: "0.78rem" }}
                  value={galleryCaptionInput}
                  disabled={isUploadingGallery}
                  onChange={(e) => setGalleryCaptionInput(e.target.value)}
                />
                <UnifiedMediaUploadButton
                  uploading={isUploadingGallery}
                  allowImageUploads={allowImageUploads}
                  allowVideoUploads={allowVideoUploads}
                  maxVideoUploadMb={maxVideoUploadMb}
                  btnClassName="btn btn-sm btn-emerald"
                  onUploadFiles={handleUnifiedUpload}
                />
              </div>
            )}

            {canMutate && (
              <MediaUploadFormatHint
                allowImageUploads={allowImageUploads}
                allowVideoUploads={allowVideoUploads}
                maxVideoUploadMb={maxVideoUploadMb}
              />
            )}
          </div>

          {gallery.length === 0 ? (
            <div
              style={{
                padding: "30px 16px",
                textAlign: "center",
                border: "1px dashed var(--border-subtle)",
                borderRadius: 8,
                color: "var(--text-muted)",
                fontSize: "0.8rem",
              }}
            >
              <ImageIcon size={28} style={{ margin: "0 auto 8px", opacity: 0.4 }} />
              <div>No photos in this persona&apos;s album yet.</div>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))",
                gap: 12,
              }}
            >
              {gallery.map((img, idx) => (
                <div
                  key={img.id}
                  style={{
                    background: "var(--bg-card)",
                    borderRadius: 8,
                    overflow: "hidden",
                    border: "1px solid var(--border-subtle)",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      position: "relative",
                      aspectRatio: "1 / 1",
                      background: "rgba(0, 0, 0, 0.4)",
                      cursor: "pointer",
                    }}
                    onClick={() => setLightboxTarget({ kind: "gallery", index: idx })}
                    title={img.video_url ? "Click to enlarge and play video" : "Click to enlarge"}
                  >
                    <img
                      src={img.url}
                      alt={img.caption || "Persona Photo"}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    {img.video_url && (
                      <span
                        className="badge"
                        title="Image-linked video"
                        style={{
                          position: "absolute",
                          top: 6,
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
                    {img.caption && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: 0,
                          right: 0,
                          background: "linear-gradient(transparent, rgba(0, 0, 0, 0.85))",
                          padding: "12px 6px 4px",
                          fontSize: "0.7rem",
                          color: "#fff",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {img.caption}
                      </div>
                    )}
                    <div
                      style={{
                        position: "absolute",
                        top: 6,
                        right: 6,
                        background: "rgba(0,0,0,0.6)",
                        borderRadius: 4,
                        padding: 3,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "rgba(255,255,255,0.8)",
                      }}
                    >
                      <Maximize2 size={12} />
                    </div>
                  </div>
                  {canMutate && (
                    <div
                      style={{
                        padding: "5px 6px",
                        borderTop: "1px solid var(--border-subtle)",
                      }}
                    >
                      <CardMediaActionStrip
                        itemLabel={img.caption || `Photo #${idx + 1}`}
                        isPublic={Boolean(img.is_public)}
                        hasVideo={Boolean(img.video_url)}
                        busy={busyGalleryId === img.id}
                        allowVideoUploads={allowVideoUploads}
                        maxVideoUploadMb={maxVideoUploadMb}
                        onAttachOrReplaceVideo={(file) =>
                          handleAttachOrReplaceVideo(img, file)
                        }
                        onRemoveVideo={() => handleVideoDelete(img)}
                        onDeleteImage={() => handleGalleryDelete(img)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {lightboxTarget?.kind === "portrait" && (
        <ImageLightboxModal
          url={lightboxTarget.url}
          label="Primary Portrait"
          onClose={() => setLightboxTarget(null)}
        />
      )}

      {lightboxTarget?.kind === "gallery" && gallery[lightboxTarget.index] && (
        <ImageLightboxModal
          url={gallery[lightboxTarget.index].url}
          videoUrl={gallery[lightboxTarget.index].video_url}
          videoMimeType={gallery[lightboxTarget.index].video_mime_type}
          autoPlayVideo={false}
          label={gallery[lightboxTarget.index].caption || "Persona Photo"}
          counterText={
            gallery.length > 1
              ? `${lightboxTarget.index + 1} / ${gallery.length}`
              : undefined
          }
          onPrev={
            gallery.length > 1
              ? () =>
                  setLightboxTarget((prev) =>
                    prev?.kind === "gallery"
                      ? {
                          kind: "gallery",
                          index: (prev.index - 1 + gallery.length) % gallery.length,
                        }
                      : null
                  )
              : undefined
          }
          onNext={
            gallery.length > 1
              ? () =>
                  setLightboxTarget((prev) =>
                    prev?.kind === "gallery"
                      ? { kind: "gallery", index: (prev.index + 1) % gallery.length }
                      : null
                  )
              : undefined
          }
          onClose={() => setLightboxTarget(null)}
        />
      )}
    </>
  );
};
