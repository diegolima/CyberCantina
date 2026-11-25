import React, { useEffect, useState } from "react";
import { Film, Image as ImageIcon, Maximize2, User } from "lucide-react";
import { CharacterRecord } from "../../../types";
import { BASIC_EMOTIONS } from "../../character/characterMediaUtils";
import { ImageLightboxModal } from "../../shared/ImageLightboxModal";

export interface CampaignCharacterMediaTabProps {
  character: CharacterRecord;
  isActive: boolean;
}

export const CampaignCharacterMediaTab: React.FC<CampaignCharacterMediaTabProps> = ({
  character,
  isActive,
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [portraitLightbox, setPortraitLightbox] = useState<{
    url: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    setLightboxIndex(null);
    setPortraitLightbox(null);
  }, [character.id]);

  const portraitCount = Object.keys(character.portraits ?? {}).length;
  const gallery = character.gallery ?? [];

  return (
    <>
      <div
        className="codex-media-stack"
        style={{
          display: isActive ? "flex" : "none",
        }}
      >
        {/* Emotional Expression Portraits Section */}
        <div className="codex-section-card">
          <div className="codex-section-label">
            <User size={12} /> Emotional Expression Portraits ({portraitCount}/8)
          </div>
          <div className="codex-muted-note">
            Expressions shift automatically with live CARE mood. Edit or upload expressions in the main Character Sheet.
          </div>

          <div className="codex-portrait-grid">
            {BASIC_EMOTIONS.map(({ key, label, description }) => {
              const portraitUrl = character.portraits?.[key];
              return (
                <div
                  key={key}
                  style={{
                    background: "var(--bg-panel)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: 8,
                    padding: "10px 8px",
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
                        fontSize: "0.73rem",
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
                        fontSize: "0.66rem",
                        color: "var(--text-muted)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 108,
                      }}
                      title={description}
                    >
                      {description}
                    </span>
                  </div>

                  {portraitUrl ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPortraitLightbox({
                          url: portraitUrl,
                          label: `${character.name} · ${label}`,
                        })
                      }
                      title={`Inspect ${label} portrait`}
                      style={{
                        position: "relative",
                        width: 76,
                        height: 76,
                        borderRadius: "50%",
                        overflow: "hidden",
                        border: "2px solid var(--accent-amber)",
                        background: "rgba(0, 0, 0, 0.4)",
                        padding: 0,
                        cursor: "pointer",
                        boxShadow: "0 0 12px rgba(245, 158, 11, 0.15)",
                      }}
                    >
                      <img
                        src={portraitUrl}
                        alt={label}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    </button>
                  ) : (
                    <div
                      style={{
                        position: "relative",
                        width: 76,
                        height: 76,
                        borderRadius: "50%",
                        overflow: "hidden",
                        border: "2px dashed var(--border-subtle)",
                        background: "rgba(0, 0, 0, 0.4)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <User
                        size={26}
                        style={{ color: "var(--text-muted)", opacity: 0.5 }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Photo Album Section */}
        <div className="codex-section-card">
          <div className="codex-section-label">
            <ImageIcon size={12} /> Photo Album ({gallery.length})
          </div>
          {gallery.length === 0 ? (
            <div className="codex-muted-note">
              No photos in this character&apos;s album yet.
            </div>
          ) : (
            <div className="codex-gallery-grid">
              {gallery.map((img, idx) => (
                <button
                  key={img.id || img.url}
                  type="button"
                  style={{
                    position: "relative",
                    aspectRatio: "1 / 1",
                    borderRadius: 8,
                    overflow: "hidden",
                    background: "rgba(0, 0, 0, 0.4)",
                    border: "1px solid var(--border-subtle)",
                    padding: 0,
                    cursor: "pointer",
                  }}
                  onClick={() => setLightboxIndex(idx)}
                  title={
                    img.video_url
                      ? `${img.caption || "Photo"} (video linked)`
                      : img.caption || "Inspect photo"
                  }
                >
                  <img
                    src={img.url}
                    alt={img.caption || "Character Photo"}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "cover",
                      display: "block",
                    }}
                  />

                  {img.video_url && (
                    <div
                      title="Linked video plays when expanded"
                      style={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        background: "rgba(15, 23, 42, 0.82)",
                        borderRadius: 4,
                        padding: "2px 6px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        color: "#e2e8f0",
                        fontSize: "0.66rem",
                      }}
                    >
                      <Film size={11} /> Video
                    </div>
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
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {portraitLightbox && (
        <ImageLightboxModal
          url={portraitLightbox.url}
          label={portraitLightbox.label}
          onClose={() => setPortraitLightbox(null)}
        />
      )}

      {lightboxIndex !== null && gallery[lightboxIndex] && (
        <ImageLightboxModal
          url={gallery[lightboxIndex].url}
          videoUrl={gallery[lightboxIndex].video_url}
          videoMimeType={gallery[lightboxIndex].video_mime_type}
          autoPlayVideo={true}
          label={gallery[lightboxIndex].caption || character.name}
          subtitle={gallery[lightboxIndex].caption ? character.name : undefined}
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
