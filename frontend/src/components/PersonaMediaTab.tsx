import React, { useEffect, useState } from "react";
import {
  Image as ImageIcon,
  Info,
  Loader2,
  Maximize2,
  Trash2,
  Upload,
  UserCheck,
  X,
} from "lucide-react";
import { api } from "../api";
import type { GalleryImage, PersonaRecord } from "../types";
import { cropToSquareBlob } from "./character/characterMediaUtils";

export interface PersonaMediaTabProps {
  isActive: boolean;
  personaId: string | null;
  isReadOnly: boolean;
  isUnsavedDraft: boolean;
  portraitUrl: string | null;
  gallery: GalleryImage[];
  onMediaUpdated: (updated: PersonaRecord) => void;
}

export const PersonaMediaTab: React.FC<PersonaMediaTabProps> = ({
  isActive,
  personaId,
  isReadOnly,
  isUnsavedDraft,
  portraitUrl,
  gallery,
  onMediaUpdated,
}) => {
  const [isUploadingPortrait, setIsUploadingPortrait] = useState(false);
  const [isUploadingGallery, setIsUploadingGallery] = useState(false);
  const [galleryCaptionInput, setGalleryCaptionInput] = useState("");
  const [lightboxImage, setLightboxImage] = useState<{
    id?: string;
    url: string;
    caption?: string;
    created_at?: string;
    isPortrait?: boolean;
  } | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const canMutate = Boolean(personaId) && !isReadOnly && !isUnsavedDraft;

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
      if (lightboxImage?.isPortrait) {
        setLightboxImage(null);
      }
      onMediaUpdated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to remove persona portrait.");
    } finally {
      setIsUploadingPortrait(false);
    }
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!personaId || !canMutate || !files || files.length === 0) return;
    setIsUploadingGallery(true);
    setMediaError(null);
    try {
      let latest: PersonaRecord | null = null;
      for (let i = 0; i < files.length; i++) {
        latest = await api.uploadPersonaGalleryImage(
          personaId,
          files[i],
          galleryCaptionInput.trim() || undefined
        );
      }
      if (latest) {
        onMediaUpdated(latest);
      }
      setGalleryCaptionInput("");
    } catch (err: any) {
      setMediaError(err?.message || "Failed to upload photo to album.");
    } finally {
      setIsUploadingGallery(false);
      e.target.value = "";
    }
  };

  const handleGalleryDelete = async (imageId: string) => {
    if (!personaId || !canMutate) return;
    if (!window.confirm("Delete this photo from the persona's photo album?")) return;
    setMediaError(null);
    try {
      const updated = await api.deletePersonaGalleryImage(personaId, imageId);
      if (lightboxImage?.id === imageId) {
        setLightboxImage(null);
      }
      onMediaUpdated(updated);
    } catch (err: any) {
      setMediaError(err?.message || "Failed to delete photo.");
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
                setLightboxImage({
                  url: portraitUrl,
                  caption: "Primary Portrait",
                  isPortrait: true,
                });
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
                  className="btn btn-sm btn-emerald"
                  style={{ cursor: isUploadingPortrait ? "wait" : "pointer" }}
                >
                  <Upload size={12} />
                  <span>{portraitUrl ? "Replace Portrait" : "Upload Portrait"}</span>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={isUploadingPortrait}
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
                  onChange={(e) => setGalleryCaptionInput(e.target.value)}
                />
                <label
                  className="btn btn-sm btn-emerald"
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
                    alt={img.caption || "Persona Photo"}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
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
              ))}
            </div>
          )}
        </div>
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
              alt={lightboxImage.caption || "Persona Photo"}
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
                  <span style={{ fontStyle: "italic", opacity: 0.6 }}>No caption</span>
                )}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {lightboxImage.created_at && (
                  <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                    {new Date(lightboxImage.created_at).toLocaleDateString()}
                  </span>
                )}
                {canMutate && (lightboxImage.isPortrait || lightboxImage.id) && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{
                      color: "#f87171",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                    }}
                    onClick={() => {
                      if (lightboxImage.isPortrait) {
                        handlePortraitDelete();
                      } else if (lightboxImage.id) {
                        handleGalleryDelete(lightboxImage.id);
                      }
                    }}
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
