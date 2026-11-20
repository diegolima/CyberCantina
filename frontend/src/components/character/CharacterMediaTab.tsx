import React, { useState } from "react";
import { Film, Image as ImageIcon, Loader2, Maximize2, Trash2, Upload, User } from "lucide-react";
import { api } from "../../api";
import type { AppSettings, BasicEmotion, CharacterRecord, GalleryImage } from "../../types";
import { BASIC_EMOTIONS, cropToSquareBlob } from "./characterMediaUtils";
import { ImageLightboxModal } from "../shared/ImageLightboxModal";
import {
  CardMediaActionStrip,
  MediaUploadFormatHint,
  UnifiedMediaUploadButton,
  buildImageDeleteConfirmMessage,
  uploadUnifiedMediaBatch,
} from "../shared/VideoUploadControls";

export interface CharacterMediaTabProps {
  isActive: boolean;
  characterId: string;
  latestCharacter: CharacterRecord;
  setLatestCharacter: React.Dispatch<React.SetStateAction<CharacterRecord>>;
  setCharacterId: React.Dispatch<React.SetStateAction<string>>;
  portraits: Record<string, string>;
  gallery: GalleryImage[];
  setPortraits: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setGallery: React.Dispatch<React.SetStateAction<GalleryImage[]>>;
  viewingHistory: boolean;
  appSettings?: AppSettings | null;
  isAdmin?: boolean;
  onSaved: (updated: CharacterRecord, closeModal?: boolean) => void;
}

export const CharacterMediaTab: React.FC<CharacterMediaTabProps> = ({
  isActive,
  characterId,
  latestCharacter,
  setLatestCharacter,
  setCharacterId,
  portraits,
  gallery,
  setPortraits,
  setGallery,
  viewingHistory,
  appSettings = null,
  isAdmin = false,
  onSaved,
}) => {
  const [activeMediaSubTab, setActiveMediaSubTab] = useState<"portraits" | "gallery">("portraits");
  const [uploadingEmotion, setUploadingEmotion] = useState<string | null>(null);
  const [isUploadingGallery, setIsUploadingGallery] = useState<boolean>(false);
  const [busyGalleryId, setBusyGalleryId] = useState<string | null>(null);
  const [galleryCaptionInput, setGalleryCaptionInput] = useState<string>("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const allowImageUploads = isAdmin || (appSettings?.allow_image_uploads ?? true);
  const allowVideoUploads = isAdmin || (appSettings?.allow_video_uploads ?? true);
  const maxVideoUploadMb = appSettings?.max_video_upload_mb ?? 15;

  const handlePortraitUpload = async (emotion: BasicEmotion, file: File) => {
    setUploadingEmotion(emotion);
    setMediaError(null);
    try {
      const blob = await cropToSquareBlob(file, 512);
      const updated = await api.uploadCharacterPortrait(characterId, emotion, blob);
      setLatestCharacter(updated);
      setCharacterId(updated.id);
      setPortraits(updated.portraits ?? {});
      onSaved(updated, false);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to upload portrait");
    } finally {
      setUploadingEmotion(null);
    }
  };

  const handlePortraitDelete = async (emotion: BasicEmotion) => {
    if (!window.confirm(`Delete the "${emotion}" portrait?`)) return;
    setUploadingEmotion(emotion);
    setMediaError(null);
    try {
      const updated = await api.deleteCharacterPortrait(characterId, emotion);
      setLatestCharacter(updated);
      setCharacterId(updated.id);
      setPortraits(updated.portraits ?? {});
      onSaved(updated, false);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to delete portrait");
    } finally {
      setUploadingEmotion(null);
    }
  };

  const syncCharacterMedia = (updated: CharacterRecord) => {
    setLatestCharacter(updated);
    setCharacterId(updated.id);
    setGallery(updated.gallery ?? []);
    onSaved(updated, false);
  };

  const handleUnifiedUpload = async (files: File[]) => {
    if (files.length === 0) return;
    setIsUploadingGallery(true);
    setMediaError(null);
    let currentCharId = characterId;
    const ok = await uploadUnifiedMediaBatch<CharacterRecord>({
      files,
      allowImageUploads,
      allowVideoUploads,
      label: galleryCaptionInput,
      uploadImage: async (file, singleLabel) => {
        const updated = await api.uploadCharacterGalleryImage(
          currentCharId,
          file,
          singleLabel ?? (galleryCaptionInput.trim() || undefined)
        );
        currentCharId = updated.id;
        return updated;
      },
      uploadVideo: async (file, singleLabel) => {
        const updated = await api.uploadCharacterGalleryVideo(
          currentCharId,
          file,
          singleLabel ?? (galleryCaptionInput.trim() || undefined),
          null
        );
        currentCharId = updated.id;
        return updated;
      },
      onSuccess: (latestChar) => {
        syncCharacterMedia(latestChar);
      },
      onError: (msg) => setMediaError(msg),
    });
    if (ok) {
      setGalleryCaptionInput("");
    }
    setIsUploadingGallery(false);
  };

  const handleGalleryDelete = async (img: GalleryImage) => {
    setBusyGalleryId(img.id);
    setMediaError(null);
    try {
      const impact = await api.getCharacterGalleryImpact(characterId, img.id);
      const msg = buildImageDeleteConfirmMessage({
        itemLabel: img.caption || "Photo Album Image",
        isPublic: Boolean(img.is_public ?? impact.is_public),
        campaignsUsing: impact.campaigns_using || 0,
        hasLinkedVideo: Boolean(impact.has_linked_video ?? img.video_url),
      });
      if (!window.confirm(msg)) {
        setBusyGalleryId(null);
        return;
      }
      const updated = await api.deleteCharacterGalleryImage(characterId, img.id);
      setLightboxIndex(null);
      syncCharacterMedia(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to delete photo");
    } finally {
      setBusyGalleryId(null);
    }
  };

  const handleAttachOrReplaceVideo = async (img: GalleryImage, file: File) => {
    setBusyGalleryId(img.id);
    setMediaError(null);
    try {
      const updated = await api.uploadCharacterGalleryVideo(
        characterId,
        file,
        img.caption || undefined,
        img.id
      );
      syncCharacterMedia(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to upload video to album");
    } finally {
      setBusyGalleryId(null);
    }
  };

  const handleVideoDelete = async (img: GalleryImage) => {
    if (!img.video_url) return;
    if (
      !window.confirm(
        `Remove the linked video from "${img.caption || "Character Photo"}"?\n\nThe still image will be preserved.`
      )
    ) {
      return;
    }
    setBusyGalleryId(img.id);
    setMediaError(null);
    try {
      const updated = await api.deleteCharacterGalleryVideo(characterId, img.id);
      setLatestCharacter(updated);
      setCharacterId(updated.id);
      setGallery(updated.gallery ?? []);
      onSaved(updated, false);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to remove linked video");
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
            {/* Subtabs Pill Switcher */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                borderBottom: "1px solid var(--border-subtle)",
                paddingBottom: 10,
              }}
            >
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className={`btn btn-sm ${
                    activeMediaSubTab === "portraits" ? "btn-amber" : ""
                  }`}
                  onClick={() => setActiveMediaSubTab("portraits")}
                >
                  <User size={13} />
                  <span>Portraits ({Object.keys(portraits).length}/8)</span>
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${
                    activeMediaSubTab === "gallery" ? "btn-amber" : ""
                  }`}
                  onClick={() => setActiveMediaSubTab("gallery")}
                >
                  <ImageIcon size={13} />
                  <span>Photo Album ({gallery.length})</span>
                </button>
              </div>

              {mediaError && (
                <div style={{ color: "#fda4af", fontSize: "0.75rem" }}>
                  {mediaError}
                </div>
              )}
            </div>

            {/* Portraits Subtab */}
            {activeMediaSubTab === "portraits" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div
                  style={{
                    fontSize: "0.78rem",
                    color: "var(--text-secondary)",
                    lineHeight: 1.4,
                  }}
                >
                  Portraits for dialogue expressions and reactions. Uploaded avatars are cropped to a circular avatar format and persisted statically.
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                    gap: 14,
                  }}
                >
                  {BASIC_EMOTIONS.map(({ key, label, description }) => {
                    const portraitUrl = portraits[key];
                    const isUploading = uploadingEmotion === key;
                    return (
                      <div
                        key={key}
                        style={{
                          background: "var(--bg-card)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: 8,
                          padding: "12px 8px",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 8,
                          textAlign: "center",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: 2,
                          }}
                        >
                          <span
                            style={{
                              fontSize: "0.75rem",
                              fontWeight: 700,
                              textTransform: "uppercase",
                              letterSpacing: "0.05em",
                              color: portraitUrl
                                ? "var(--accent-amber)"
                                : "var(--text-secondary)",
                            }}
                          >
                            {label}
                          </span>
                          <span
                            style={{
                              fontSize: "0.68rem",
                              color: "var(--text-muted)",
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              maxWidth: 110,
                            }}
                            title={description}
                          >
                            {description}
                          </span>
                        </div>

                        <label
                          style={{
                            position: "relative",
                            width: 86,
                            height: 86,
                            borderRadius: "50%",
                            overflow: "hidden",
                            border: portraitUrl
                              ? "2px solid var(--accent-amber)"
                              : "2px dashed var(--border-subtle)",
                            background: "rgba(0, 0, 0, 0.4)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: viewingHistory || !allowImageUploads ? "default" : "pointer",
                            boxShadow: portraitUrl
                              ? "0 0 12px rgba(245, 158, 11, 0.15)"
                              : "none",
                          }}
                        >
                          {portraitUrl ? (
                            <img
                              src={portraitUrl}
                              alt={label}
                              style={{
                                width: "100%",
                                height: "100%",
                                objectFit: "cover",
                              }}
                            />
                          ) : (
                            <User
                              size={30}
                              style={{ color: "var(--text-muted)", opacity: 0.5 }}
                            />
                          )}

                          {isUploading && (
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
                              <Loader2
                                size={22}
                                className="spin"
                                style={{ color: "var(--accent-amber)" }}
                              />
                            </div>
                          )}

                          {!viewingHistory && !isUploading && allowImageUploads && (
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display: "none" }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) {
                                  handlePortraitUpload(key, file);
                                }
                                e.target.value = "";
                              }}
                            />
                          )}
                        </label>

                        {!viewingHistory && (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              marginTop: 2,
                            }}
                          >
                            <label
                              className={`btn btn-sm ${!allowImageUploads ? "disabled" : ""}`}
                              style={{
                                fontSize: "0.7rem",
                                padding: "3px 8px",
                                cursor: !allowImageUploads
                                  ? "not-allowed"
                                  : isUploading
                                  ? "wait"
                                  : "pointer",
                                opacity: allowImageUploads ? 1 : 0.55,
                              }}
                              title={
                                allowImageUploads
                                  ? undefined
                                  : "Image uploads are disabled by administrator"
                              }
                            >
                              <Upload size={11} />
                              <span>{portraitUrl ? "Replace" : "Upload"}</span>
                              <input
                                type="file"
                                accept="image/*"
                                disabled={isUploading || !allowImageUploads}
                                style={{ display: "none" }}
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) {
                                    handlePortraitUpload(key, file);
                                  }
                                  e.target.value = "";
                                }}
                              />
                            </label>
                            {portraitUrl && (
                              <button
                                type="button"
                                className="btn btn-sm"
                                style={{
                                  padding: "3px 6px",
                                  color: "#f87171",
                                  borderColor: "rgba(239, 68, 68, 0.3)",
                                }}
                                title={`Remove ${label} portrait`}
                                onClick={() => handlePortraitDelete(key)}
                              >
                                <Trash2 size={12} />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Photo Album Subtab */}
            {activeMediaSubTab === "gallery" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                      Click thumbnail to inspect in lightbox
                    </span>
                  </div>

                  {!viewingHistory && (
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
                        btnClassName="btn btn-sm btn-amber"
                        onUploadFiles={handleUnifiedUpload}
                      />
                    </div>
                  )}

                  {!viewingHistory && (
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
                      padding: "36px 16px",
                      textAlign: "center",
                      border: "1px dashed var(--border-subtle)",
                      borderRadius: 8,
                      color: "var(--text-muted)",
                      fontSize: "0.82rem",
                    }}
                  >
                    <ImageIcon size={32} style={{ margin: "0 auto 8px", opacity: 0.4 }} />
                    <div>No photos in this character's album yet.</div>
                    {!viewingHistory && (
                      <div style={{ marginTop: 6, fontSize: "0.75rem" }}>
                        Upload reference artwork, combat stills, scene snapshots, or outfits.
                      </div>
                    )}
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
                          onClick={() => setLightboxIndex(idx)}
                          title={img.video_url ? "Click to enlarge and play video" : "Click to enlarge"}
                        >
                          <img
                            src={img.url}
                            alt={img.caption || "Character Photo"}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
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
                                background:
                                  "linear-gradient(transparent, rgba(0, 0, 0, 0.85))",
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

                        {!viewingHistory && (
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
            )}
          </div>

        {lightboxIndex !== null && gallery[lightboxIndex] && (
          <ImageLightboxModal
            url={gallery[lightboxIndex].url}
            videoUrl={gallery[lightboxIndex].video_url}
            videoMimeType={gallery[lightboxIndex].video_mime_type}
            autoPlayVideo={false}
            label={gallery[lightboxIndex].caption || latestCharacter.name}
            subtitle={gallery[lightboxIndex].caption ? latestCharacter.name : undefined}
            counterText={
              gallery.length > 1
                ? `${lightboxIndex + 1} / ${gallery.length}`
                : undefined
            }
            onPrev={
              gallery.length > 1
                ? () =>
                    setLightboxIndex(
                      (prev) => ((prev ?? 0) - 1 + gallery.length) % gallery.length
                    )
                : undefined
            }
            onNext={
              gallery.length > 1
                ? () =>
                    setLightboxIndex((prev) => ((prev ?? 0) + 1) % gallery.length)
                : undefined
            }
            onClose={() => setLightboxIndex(null)}
          />
        )}
    </>
  );
};
