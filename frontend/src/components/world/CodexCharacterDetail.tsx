import React, { useEffect, useState } from "react";
import { Film, Image as ImageIcon, Lock, MapPin, Package, Sparkles, User, UserCheck } from "lucide-react";
import {
  GalleryImage,
  LoreNode,
  PersonaRecord,
  PersonaTurnStateSnapshot,
  normalizeItemList,
} from "../../types";
import { getCharacterEmotionPortrait, getEntityPrimaryImage } from "../../utils/entityImages";
import { ImageLightboxModal } from "../shared/ImageLightboxModal";
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
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const portraitUrl =
    kind === "character" && characterEntry
      ? getCharacterEmotionPortrait(
          characterEntry.record,
          characterEntry.state?.care_state?.active_emotion ?? "default"
        )
      : kind === "persona" && persona
      ? getEntityPrimaryImage("personas", persona)
      : null;

  const activeGallery: GalleryImage[] =
    kind === "persona" && persona
      ? persona.gallery ?? []
      : kind === "character" && characterEntry
      ? characterEntry.record.gallery ?? []
      : [];

  useEffect(() => {
    setPortraitBroken(false);
    setLightboxIndex(null);
  }, [kind, characterEntry?.record.id, persona?.id, portraitUrl]);

  const activeLightboxItem =
    lightboxIndex !== null && lightboxIndex >= 0 && lightboxIndex < activeGallery.length
      ? activeGallery[lightboxIndex]
      : null;
  const activeEntityName =
    kind === "persona" ? persona?.name : characterEntry?.record.name;

  const renderLightbox = () => {
    if (!activeLightboxItem) return null;
    const idx = lightboxIndex ?? 0;
    const total = activeGallery.length;
    return (
      <ImageLightboxModal
        url={activeLightboxItem.url}
        videoUrl={activeLightboxItem.video_url}
        videoMimeType={activeLightboxItem.video_mime_type}
        autoPlayVideo={true}
        label={activeLightboxItem.caption || activeEntityName || "Photo"}
        subtitle={activeLightboxItem.caption ? activeEntityName || undefined : undefined}
        counterText={total > 1 ? `${idx + 1} / ${total}` : undefined}
        onPrev={
          total > 1
            ? () => setLightboxIndex((prev) => ((prev ?? 0) - 1 + total) % total)
            : undefined
        }
        onNext={
          total > 1
            ? () => setLightboxIndex((prev) => ((prev ?? 0) + 1) % total)
            : undefined
        }
        onClose={() => setLightboxIndex(null)}
      />
    );
  };

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
              {gallery.map((img, idx) => (
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
                  onClick={() => setLightboxIndex(idx)}
                  title={img.video_url ? `${img.caption || "Photo"} (video linked)` : img.caption || "Inspect photo"}
                >
                  <img
                    src={img.url}
                    alt={img.caption || persona.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                  {img.video_url && (
                    <span
                      style={{
                        position: "absolute",
                        top: 4,
                        left: 4,
                        background: "rgba(15, 23, 42, 0.84)",
                        color: "#e2e8f0",
                        borderRadius: 4,
                        padding: "2px 4px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 2,
                      }}
                    >
                      <Film size={10} />
                    </span>
                  )}
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

      {renderLightbox()}
    </>
    );
  }

  if (kind === "character" && characterEntry) {
    const { record, state, isPresent, elsewhereLocationName, isPrimary } =
      characterEntry;
    const equippedItems = normalizeItemList(state?.equipped ?? record.equipped);
    const loreById = new Map(loreNodes.map((ln) => [ln.id, ln]));

    return (
      <>
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

        {activeGallery.length > 0 && (
          <div className="codex-section-card">
            <div className="codex-section-label">
              <ImageIcon size={12} /> Photo Album ({activeGallery.length})
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))",
                gap: 8,
              }}
            >
              {activeGallery.map((img, idx) => (
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
                  onClick={() => setLightboxIndex(idx)}
                  title={img.video_url ? `${img.caption || "Photo"} (video linked)` : img.caption || "Inspect photo"}
                >
                  <img
                    src={img.url}
                    alt={img.caption || record.name}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                  {img.video_url && (
                    <span
                      style={{
                        position: "absolute",
                        top: 4,
                        left: 4,
                        background: "rgba(15, 23, 42, 0.84)",
                        color: "#e2e8f0",
                        borderRadius: 4,
                        padding: "2px 4px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 2,
                      }}
                    >
                      <Film size={10} />
                    </span>
                  )}
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
      {renderLightbox()}
      </>
    );
  }

  return (
    <div className="codex-empty-detail">
      Select a character or persona on the left to inspect their dossier.
    </div>
  );
};
