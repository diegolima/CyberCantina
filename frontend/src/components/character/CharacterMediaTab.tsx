import React, { useEffect, useState } from "react";
import { Image as ImageIcon, Loader2, Maximize2, Trash2, Upload, User, X } from "lucide-react";
import { api } from "../../api";
import type { BasicEmotion, CharacterRecord, GalleryImage } from "../../types";
import { BASIC_EMOTIONS, cropToSquareBlob } from "./characterMediaUtils";

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
  onSaved,
}) => {
  const [activeMediaSubTab, setActiveMediaSubTab] = useState<"portraits" | "gallery">("portraits");
  const [uploadingEmotion, setUploadingEmotion] = useState<string | null>(null);
  const [isUploadingGallery, setIsUploadingGallery] = useState<boolean>(false);
  const [galleryCaptionInput, setGalleryCaptionInput] = useState<string>("");
  const [lightboxImage, setLightboxImage] = useState<GalleryImage | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  useEffect(() => {
    if (!lightboxImage) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxImage(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxImage]);

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

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploadingGallery(true);
    setMediaError(null);
    try {
      let latestChar = latestCharacter;
      for (let i = 0; i < files.length; i++) {
        latestChar = await api.uploadCharacterGalleryImage(
          characterId,
          files[i],
          galleryCaptionInput.trim() || undefined
        );
      }
      setLatestCharacter(latestChar);
      setCharacterId(latestChar.id);
      setGallery(latestChar.gallery ?? []);
      setGalleryCaptionInput("");
      onSaved(latestChar, false);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to upload photo to album");
    } finally {
      setIsUploadingGallery(false);
      e.target.value = "";
    }
  };

  const handleGalleryDelete = async (imageId: string) => {
    if (!window.confirm("Delete this photo from the character's photo album?")) return;
    setMediaError(null);
    try {
      const updated = await api.deleteCharacterGalleryImage(characterId, imageId);
      setLatestCharacter(updated);
      setCharacterId(updated.id);
      setGallery(updated.gallery ?? []);
      if (lightboxImage?.id === imageId) {
        setLightboxImage(null);
      }
      onSaved(updated, false);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to delete photo");
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
                            cursor: viewingHistory ? "default" : "pointer",
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

                          {!viewingHistory && !isUploading && (
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
                              className="btn btn-sm"
                              style={{
                                fontSize: "0.7rem",
                                padding: "3px 8px",
                                cursor: isUploading ? "wait" : "pointer",
                              }}
                            >
                              <Upload size={11} />
                              <span>{portraitUrl ? "Replace" : "Upload"}</span>
                              <input
                                type="file"
                                accept="image/*"
                                disabled={isUploading}
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
                        onChange={(e) => setGalleryCaptionInput(e.target.value)}
                      />
                      <label
                        className="btn btn-sm btn-amber"
                        style={{ cursor: isUploadingGallery ? "wait" : "pointer" }}
                      >
                        {isUploadingGallery ? (
                          <Loader2 size={13} className="spin" />
                        ) : (
                          <Upload size={13} />
                        )}
                        <span>{isUploadingGallery ? "Uploading..." : "Upload Photos"}</span>
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          disabled={isUploadingGallery}
                          style={{ display: "none" }}
                          onChange={handleGalleryUpload}
                        />
                      </label>
                    </div>
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
                    {gallery.map((img) => (
                      <div
                        key={img.id}
                        style={{
                          position: "relative",
                          aspectRatio: "1 / 1",
                          borderRadius: 8,
                          overflow: "hidden",
                          background: "rgba(0, 0, 0, 0.4)",
                          border: "1px solid var(--border-subtle)",
                          cursor: "pointer",
                        }}
                        onClick={() => setLightboxImage(img)}
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
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

        {lightboxImage && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.9)",
              backdropFilter: "blur(6px)",
              zIndex: 10000,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 24,
            }}
            onClick={() => setLightboxImage(null)}
          >
            <div
              style={{
                position: "relative",
                maxWidth: "92vw",
                maxHeight: "85vh",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                className="btn"
                style={{
                  position: "absolute",
                  top: -42,
                  right: 0,
                  background: "rgba(0,0,0,0.6)",
                  color: "#fff",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "50%",
                  width: 34,
                  height: 34,
                  padding: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                }}
                onClick={() => setLightboxImage(null)}
              >
                <X size={18} />
              </button>

              <img
                src={lightboxImage.url}
                alt={lightboxImage.caption || "Character Photo"}
                style={{
                  maxWidth: "100%",
                  maxHeight: "75vh",
                  objectFit: "contain",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                  boxShadow: "0 10px 40px rgba(0,0,0,0.8)",
                }}
              />

              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  color: "var(--text-secondary)",
                  fontSize: "0.82rem",
                }}
              >
                <span>
                  {lightboxImage.caption || (
                    <span style={{ fontStyle: "italic", opacity: 0.6 }}>
                      No caption
                    </span>
                  )}
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                    {new Date(lightboxImage.created_at).toLocaleDateString()}
                  </span>
                  {!viewingHistory && (
                    <button
                      type="button"
                      className="btn btn-sm"
                      style={{
                        color: "#f87171",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                      }}
                      onClick={() => handleGalleryDelete(lightboxImage.id)}
                    >
                      <Trash2 size={13} />
                      <span>Delete</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
    </>
  );
};
