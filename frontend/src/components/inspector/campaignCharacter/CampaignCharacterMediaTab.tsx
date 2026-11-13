import React, { useState } from "react";
import { Image as ImageIcon, Maximize2, User, X } from "lucide-react";
import { CharacterRecord, GalleryImage } from "../../../types";
import { BASIC_EMOTIONS } from "../../EntityEditorModals";

export interface CampaignCharacterMediaTabProps {
  character: CharacterRecord;
  isActive: boolean;
}

export const CampaignCharacterMediaTab: React.FC<CampaignCharacterMediaTabProps> = ({
  character,
  isActive,
}) => {
  const [activeMediaSubTab, setActiveMediaSubTab] = useState<"portraits" | "gallery">("portraits");
  const [lightboxImage, setLightboxImage] = useState<GalleryImage | null>(null);

  return (
    <>
          <div
            style={{
              display: isActive ? "flex" : "none",
              flexDirection: "column",
              gap: 16,
            }}
          >
            {/* Subtabs Switcher */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
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
                  <span>
                    Portraits ({Object.keys(character.portraits ?? {}).length}/8)
                  </span>
                </button>
                <button
                  type="button"
                  className={`btn btn-sm ${
                    activeMediaSubTab === "gallery" ? "btn-amber" : ""
                  }`}
                  onClick={() => setActiveMediaSubTab("gallery")}
                >
                  <ImageIcon size={13} />
                  <span>
                    Photo Album ({(character.gallery ?? []).length})
                  </span>
                </button>
              </div>
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
                  Character portrait emotional expressions. Edit or upload additional expressions in the main Character Sheet.
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                    gap: 14,
                  }}
                >
                  {BASIC_EMOTIONS.map(({ key, label, description }) => {
                    const portraitUrl = character.portraits?.[key];
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

                        <div
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
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Photo Album Subtab */}
            {activeMediaSubTab === "gallery" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {(!character.gallery || character.gallery.length === 0) ? (
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
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(135px, 1fr))",
                      gap: 12,
                    }}
                  >
                    {character.gallery.map((img) => (
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
                <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                  {new Date(lightboxImage.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          </div>
        )}
    </>
  );
};
