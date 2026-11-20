import React, { useEffect, useState } from "react";
import { Image as ImageIcon, Lock, MapPin, Package, Sparkles, User, UserCheck, X } from "lucide-react";
import {
  GalleryImage,
  LoreNode,
  PersonaRecord,
  PersonaTurnStateSnapshot,
  normalizeItemList,
} from "../../types";
import { getCharacterEmotionPortrait, getEntityPrimaryImage } from "../../utils/entityImages";
import type { CodexCampaignCharacterEntry } from "./codexHelpers";

interface CodexCharacterDetailProps {
  kind: "persona" | "character";
  persona?: PersonaRecord | null;
  personaTurnState?: PersonaTurnStateSnapshot | null;
  characterEntry?: CodexCampaignCharacterEntry | null;
  loreNodes: readonly LoreNode[];
  onJumpToLore: (loreId: string) => void;
}

export const CodexCharacterDetail: React.FC<CodexCharacterDetailProps> = ({
  kind,
  persona,
  personaTurnState,
  characterEntry,
  loreNodes,
  onJumpToLore,
}) => {
  const [portraitBroken, setPortraitBroken] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<GalleryImage | null>(null);

  const portraitUrl =
    kind === "character" && characterEntry
      ? getCharacterEmotionPortrait(
          characterEntry.record,
          characterEntry.state?.care_state?.active_emotion ?? "default"
        )
      : kind === "persona" && persona
      ? getEntityPrimaryImage("personas", persona)
      : null;

  useEffect(() => {
    setPortraitBroken(false);
  }, [kind, characterEntry?.record.id, persona?.id, portraitUrl]);

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

  if (kind === "persona" && persona) {
    const equipped = personaTurnState?.equipped ?? persona.equipped ?? [];
    const inventory = personaTurnState?.inventory ?? persona.inventory ?? [];
    const gallery = persona.gallery ?? [];
    const hasCanonicalAppearance =
      Boolean(persona.build_and_height?.trim()) ||
      (persona.distinctive_features?.length ?? 0) > 0;
    const legacyAppearance =
      !hasCanonicalAppearance && persona.physical_appearance?.trim()
        ? persona.physical_appearance.trim()
        : "";
    const heightLabel = persona.build_and_height?.includes(",")
      ? "Build & Height:"
      : "Height:";

    return (
      <>
        <div className="codex-detail-stack">
          <div className="codex-detail-header">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
              {portraitUrl && !portraitBroken ? (
                <img
                  src={portraitUrl}
                  alt={persona.name}
                  className="codex-character-portrait"
                  onError={() => setPortraitBroken(true)}
                />
              ) : (
                <div className="codex-character-portrait codex-character-portrait--fallback">
                  <UserCheck size={22} color="var(--accent-emerald)" />
                </div>
              )}

              <div style={{ minWidth: 0 }}>
                <div className="codex-detail-title-row">
                  <h3 className="codex-detail-title">{persona.name}</h3>
                </div>
                {persona.tagline?.trim() && (
                  <div className="codex-character-tagline">{persona.tagline}</div>
                )}
                <div className="codex-badge-row">
                  <span className="badge codex-badge--persona">Player Persona</span>
                  {persona.species?.trim() && (
                    <span className="badge codex-badge--muted">{persona.species}</span>
                  )}
                  {persona.sex?.trim() && (
                    <span className="badge codex-badge--muted">{persona.sex}</span>
                  )}
                  {persona.pronouns?.trim() && (
                    <span className="badge codex-badge--muted">{persona.pronouns}</span>
                  )}
                  {persona.age?.trim() && (
                    <span className="badge codex-badge--muted">
                      Age: {persona.age}
                      {persona.age_is_secret && (
                        <>
                          {" "}
                          <Lock size={10} />
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {persona.persona_bio?.trim() && (
            <div className="codex-section-card">
              <div className="codex-section-label">Bio &amp; Concept</div>
              <p className="codex-prose-text">{persona.persona_bio}</p>
            </div>
          )}

          {(hasCanonicalAppearance || legacyAppearance) && (
            <div className="codex-section-card">
              <div className="codex-section-label">Appearance</div>
              {persona.build_and_height?.trim() && (
                <div className="codex-kv-line">
                  <span>{heightLabel}</span> {persona.build_and_height}
                </div>
              )}
            {(persona.distinctive_features?.length ?? 0) > 0 && (
              <div className="codex-chip-list">
                {persona.distinctive_features!.map((feat) => (
                  <span key={feat} className="badge codex-tag-chip">
                    {feat}
                  </span>
                ))}
              </div>
            )}
            {legacyAppearance && <p className="codex-prose-text">{legacyAppearance}</p>}
          </div>
        )}

        {(persona.tags?.length ?? 0) > 0 && (
          <div className="codex-section-card">
            <div className="codex-section-label">Tags</div>
            <div className="codex-chip-list">
              {persona.tags!.map((tag) => (
                <span key={tag} className="badge codex-tag-chip">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="codex-section-card">
          <div className="codex-section-label">
            <Package size={12} /> Gear ({equipped.length} equipped · {inventory.length} carried)
          </div>
          {equipped.length === 0 && inventory.length === 0 ? (
            <div className="codex-muted-note">No items recorded.</div>
          ) : (
            <div className="codex-local-lore-list">
              {equipped.map((item) => (
                <div key={`eq-${item.id || item.name}`} className="codex-local-lore-item">
                  <div className="codex-local-lore-head">
                    <strong>{item.name}</strong>
                    <div className="codex-badge-row">
                      <span className="badge codex-badge--emerald">Equipped</span>
                      {item.is_secret && (
                        <span className="badge codex-badge--amber">
                          <Lock size={10} /> Secret
                        </span>
                      )}
                    </div>
                  </div>
                  {item.note && <p className="codex-prose-text">{item.note}</p>}
                </div>
              ))}
              {inventory.map((item) => (
                <div key={`inv-${item.id || item.name}`} className="codex-local-lore-item">
                  <div className="codex-local-lore-head">
                    <strong>{item.name}</strong>
                    <div className="codex-badge-row">
                      <span className="badge codex-badge--muted">Carried</span>
                      {item.is_secret && (
                        <span className="badge codex-badge--amber">
                          <Lock size={10} /> Secret
                        </span>
                      )}
                    </div>
                  </div>
                  {item.note && <p className="codex-prose-text">{item.note}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {(persona.lore_entries?.length ?? 0) > 0 && (
          <div className="codex-section-card">
            <div className="codex-section-label">
              Personal Lore &amp; Secrets ({persona.lore_entries.length})
            </div>
            <div className="codex-local-lore-list">
              {persona.lore_entries.map((entry) => (
                <div key={entry.id || entry.title} className="codex-local-lore-item">
                  <div className="codex-local-lore-head">
                    <strong>{entry.title}</strong>
                    <span
                      className={`badge ${
                        entry.is_secret ? "codex-badge--amber" : "codex-badge--emerald"
                      }`}
                    >
                      {entry.is_secret ? (
                        <>
                          <Lock size={10} /> Secret
                        </>
                      ) : (
                        "Public"
                      )}
                    </span>
                  </div>
                  <p className="codex-prose-text">{entry.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {gallery.length > 0 && (
          <div className="codex-section-card">
            <div className="codex-section-label">
              <ImageIcon size={12} /> Photo Album ({gallery.length})
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                gap: 8,
              }}
            >
              {gallery.map((img) => (
                <button
                  key={img.id || img.url}
                  type="button"
                  style={{
                    position: "relative",
                    aspectRatio: "1 / 1",
                    borderRadius: 6,
                    overflow: "hidden",
                    border: "1px solid var(--border-subtle)",
                    background: "rgba(0,0,0,0.35)",
                    padding: 0,
                    cursor: "pointer",
                  }}
                  onClick={() => setLightboxImage(img)}
                  title={img.caption || "Inspect photo"}
                >
                  <img
                    src={img.url}
                    alt={img.caption || persona.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                  {img.caption && (
                    <div
                      style={{
                        position: "absolute",
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: "linear-gradient(transparent, rgba(0,0,0,0.85))",
                        padding: "10px 4px 3px",
                        fontSize: "0.66rem",
                        color: "#fff",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {img.caption}
                    </div>
                  )}
                </button>
              ))}
            </div>
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
              maxWidth: "90vw",
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
                top: -40,
                right: 0,
                borderRadius: "50%",
                width: 32,
                height: 32,
                padding: 0,
              }}
              onClick={() => setLightboxImage(null)}
              aria-label="Close photo preview"
            >
              <X size={16} />
            </button>
            <img
              src={lightboxImage.url}
              alt={lightboxImage.caption || persona.name}
              style={{
                maxWidth: "100%",
                maxHeight: "75vh",
                objectFit: "contain",
                borderRadius: 8,
                border: "1px solid var(--border-subtle)",
              }}
            />
            {lightboxImage.caption && (
              <div style={{ marginTop: 10, fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                {lightboxImage.caption}
              </div>
            )}
          </div>
        </div>
      )}
    </>
    );
  }

  if (kind === "character" && characterEntry) {
    const { record, state, isPresent, elsewhereLocationName, isPrimary } =
      characterEntry;
    const equippedItems = normalizeItemList(state?.equipped ?? record.equipped);
    const loreById = new Map(loreNodes.map((ln) => [ln.id, ln]));

    return (
      <div className="codex-detail-stack">
        <div className="codex-detail-header">
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12, minWidth: 0 }}>
            {portraitUrl && !portraitBroken ? (
              <img
                src={portraitUrl}
                alt={record.name}
                className="codex-character-portrait"
                onError={() => setPortraitBroken(true)}
              />
            ) : (
              <div className="codex-character-portrait codex-character-portrait--fallback">
                <User size={22} color="var(--accent-cyan)" />
              </div>
            )}

            <div style={{ minWidth: 0 }}>
              <div className="codex-detail-title-row">
                <h3 className="codex-detail-title">{record.name}</h3>
              </div>
              {record.tagline?.trim() && (
                <div className="codex-character-tagline">{record.tagline}</div>
              )}
              <div className="codex-badge-row">
                <span className="badge codex-badge--character">
                  {isPrimary ? "Primary Character" : "Campaign Character"}
                </span>
                {typeof isPresent === "boolean" && (
                  <span
                    className={`badge ${
                      isPresent ? "codex-badge--emerald" : "codex-badge--violet"
                    }`}
                  >
                    <MapPin size={10} />{" "}
                    {isPresent
                      ? "Present"
                      : `Elsewhere${elsewhereLocationName ? `: ${elsewhereLocationName}` : ""}`}
                  </span>
                )}
                {record.species?.trim() && (
                  <span className="badge codex-badge--muted">{record.species}</span>
                )}
                {record.age?.trim() && (
                  <span className="badge codex-badge--muted">Age: {record.age}</span>
                )}
                {record.sex?.trim() && (
                  <span className="badge codex-badge--muted">{record.sex}</span>
                )}
                {record.pronouns?.trim() && (
                  <span className="badge codex-badge--muted">{record.pronouns}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {record.character_bio?.trim() && (
          <div className="codex-section-card">
            <div className="codex-section-label">Public Biography</div>
            <p className="codex-prose-text">{record.character_bio}</p>
          </div>
        )}

        {(record.build_and_height?.trim() ||
          record.posture?.trim() ||
          record.visual_aesthetic?.trim() ||
          (record.distinctive_features?.length ?? 0) > 0 ||
          (record.mannerisms?.length ?? 0) > 0) && (
          <div className="codex-section-card">
            <div className="codex-section-label">Appearance &amp; Bearing</div>
            {record.build_and_height?.trim() && (
              <div className="codex-kv-line">
                <span>Height:</span> {record.build_and_height}
              </div>
            )}
            {record.posture?.trim() && (
              <div className="codex-kv-line">
                <span>Posture:</span> {record.posture}
              </div>
            )}
            {record.visual_aesthetic?.trim() && (
              <div className="codex-kv-line">
                <span>Visual Aesthetic:</span> {record.visual_aesthetic}
              </div>
            )}
            {(record.distinctive_features?.length ?? 0) > 0 && (
              <div style={{ marginTop: 6 }}>
                <div className="codex-sub-label">Distinctive Features</div>
                <div className="codex-chip-list">
                  {record.distinctive_features!.map((feat) => (
                    <span key={feat} className="badge codex-tag-chip">
                      {feat}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {(record.mannerisms?.length ?? 0) > 0 && (
              <div style={{ marginTop: 6 }}>
                <div className="codex-sub-label">Mannerisms</div>
                <div className="codex-chip-list">
                  {record.mannerisms!.map((tell) => (
                    <span key={tell} className="badge codex-tag-chip">
                      {tell}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {(record.communication_style?.length ?? 0) > 0 && (
          <div className="codex-section-card">
            <div className="codex-section-label">Communication Style</div>
            <div className="codex-chip-list">
              {record.communication_style!.map((style) => (
                <span key={style} className="badge codex-tag-chip">
                  {style}
                </span>
              ))}
            </div>
          </div>
        )}

        {equippedItems.length > 0 && (
          <div className="codex-section-card">
            <div className="codex-section-label">
              <Package size={12} /> Visible Equipped Gear ({equippedItems.length})
            </div>
            <div className="codex-local-lore-list">
              {equippedItems.map((item) => {
                const linkedLore =
                  item.flags.includes("artifact") && item.lore_id
                    ? loreById.get(item.lore_id)
                    : undefined;
                return (
                  <div key={item.id || item.name} className="codex-local-lore-item">
                    <div className="codex-local-lore-head">
                      <strong>{item.name}</strong>
                      {linkedLore ? (
                        <button
                          type="button"
                          className="item-flag-pill item-flag-artifact codex-artifact-jump"
                          onClick={() => onJumpToLore(linkedLore.id)}
                          title={`Open artifact entry: ${linkedLore.title}`}
                        >
                          <Sparkles size={10} /> Artifact: {linkedLore.title} →
                        </button>
                      ) : item.flags.includes("artifact") ? (
                        <span className="item-flag-pill item-flag-artifact">
                          Artifact
                        </span>
                      ) : null}
                    </div>
                    {item.note && <p className="codex-prose-text">{item.note}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(record.tags?.length ?? 0) > 0 && (
          <div className="codex-section-card">
            <div className="codex-section-label">Tags</div>
            <div className="codex-chip-list">
              {record.tags!.map((tag) => (
                <span key={tag} className="badge codex-tag-chip">
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="codex-empty-detail">
      Select a character or persona on the left to inspect their dossier.
    </div>
  );
};
