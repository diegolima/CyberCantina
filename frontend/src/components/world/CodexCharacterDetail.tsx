import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BookOpen,
  Brain,
  ChevronDown,
  ChevronUp,
  Database,
  Eye,
  Film,
  Image as ImageIcon,
  Lock,
  MapPin,
  MessageSquare,
  Package,
  ScrollText,
  Sparkles,
  User,
  UserCheck,
  Users,
} from "lucide-react";
import {
  CodexReturnTarget,
  GalleryImage,
  ItemEquipActionPayload,
  LocationNode,
  LoreNode,
  MechanicsTopicId,
  MemoryShard,
  PersonaRecord,
  PersonaTurnStateSnapshot,
  PhysicalStateOverridePayload,
  TurnNodeRecord,
  getTemperamentPresetMeta,
  splitLegacyWornItems,
} from "../../types";
import { getCharacterEmotionPortrait, getEntityPrimaryImage } from "../../utils/entityImages";
import { ImageLightboxModal } from "../shared/ImageLightboxModal";
import { MechanicsHelpButton } from "../shared/MechanicsHelpButton";
import { PhysicalStateControl } from "../shared/PhysicalStateControl";
import { CampaignCharacterInventoryTab } from "./codexCharacter/CampaignCharacterInventoryTab";
import { CampaignCharacterMediaTab } from "./codexCharacter/CampaignCharacterMediaTab";
import { CampaignCharacterMemoriesTab } from "./codexCharacter/CampaignCharacterMemoriesTab";
import { CampaignCharacterStateTab } from "./codexCharacter/CampaignCharacterStateTab";
import type { CodexCampaignCharacterEntry } from "./codexHelpers";

export type CodexCharacterSubtab =
  | "bio"
  | "appearance"
  | "personality"
  | "voice"
  | "memories"
  | "inventory"
  | "current"
  | "media";

export type CodexPersonaSubtab =
  | "bio"
  | "appearance"
  | "gear"
  | "lore"
  | "media";

interface CodexCharacterDetailProps {
  kind: "persona" | "character";
  persona?: PersonaRecord | null;
  personaTurnState?: PersonaTurnStateSnapshot | null;
  characterEntry?: CodexCampaignCharacterEntry | null;
  loreNodes: readonly LoreNode[];
  onJumpToLore: (loreId: string) => void;
  initialSubtab?: CodexCharacterSubtab;
  initialPersonaSubtab?: CodexPersonaSubtab;
  focusNonce?: number;
  locations?: LocationNode[];
  activeWorldName?: string;
  characterNameMap?: Record<string, string>;
  activeBranchTurns?: readonly TurnNodeRecord[];
  isMutatingLocked?: boolean;
  onItemAction?: (payload: ItemEquipActionPayload) => Promise<void> | void;
  onSaveMemories?: (characterId: string, shards: MemoryShard[]) => Promise<void>;
  onRelocateCharacter?: (characterId: string, locationId: string) => Promise<void> | void;
  onOverrideCharacterPhysicalState?: (
    characterId: string,
    payload: PhysicalStateOverridePayload
  ) => Promise<void> | void;
  onOverridePlayerPhysicalState?: (
    payload: PhysicalStateOverridePayload
  ) => Promise<void> | void;
  onOpenMechanicsHelp?: (
    topicId: MechanicsTopicId,
    returnTarget?: CodexReturnTarget
  ) => void;
}

function resolveCharacterInitialTab(
  requested: CodexCharacterSubtab | undefined,
  hasState: boolean
): CodexCharacterSubtab {
  if (!requested) return "bio";
  if (requested === "current" && !hasState) return "bio";
  return requested;
}

export const CodexCharacterDetail: React.FC<CodexCharacterDetailProps> = ({
  kind,
  persona,
  personaTurnState,
  characterEntry,
  loreNodes,
  onJumpToLore,
  initialSubtab,
  initialPersonaSubtab,
  focusNonce = 0,
  locations = [],
  activeWorldName,
  characterNameMap = {},
  activeBranchTurns = [],
  isMutatingLocked = false,
  onItemAction,
  onSaveMemories,
  onRelocateCharacter,
  onOverrideCharacterPhysicalState,
  onOverridePlayerPhysicalState,
  onOpenMechanicsHelp,
}) => {
  const hasState = Boolean(characterEntry?.state);
  const [activeCharTab, setActiveCharTab] = useState<CodexCharacterSubtab>(() =>
    resolveCharacterInitialTab(initialSubtab, hasState)
  );
  const [activePersonaTab, setActivePersonaTab] = useState<CodexPersonaSubtab>(
    () => initialPersonaSubtab ?? "bio"
  );
  const [activeBioDrawer, setActiveBioDrawer] = useState<
    "creator_notes" | "opening_scene" | null
  >(null);
  const [memoryCount, setMemoryCount] = useState<number>(
    characterEntry?.record.memory_shards.length ?? 0
  );
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

  useEffect(() => {
    if (kind !== "character" || !characterEntry) return;
    setActiveCharTab(resolveCharacterInitialTab(initialSubtab, Boolean(characterEntry.state)));
    setActiveBioDrawer(null);
    setMemoryCount(characterEntry.record.memory_shards.length);
  }, [kind, characterEntry?.record.id, initialSubtab, focusNonce]);

  useEffect(() => {
    if (kind !== "persona" || !persona) return;
    setActivePersonaTab(initialPersonaSubtab ?? "bio");
  }, [kind, persona?.id, initialPersonaSubtab, focusNonce]);

  const worldArtifactNodes = useMemo(
    () =>
      loreNodes.filter((ln) => ln.category === "artifact" && !ln.location_id),
    [loreNodes]
  );

  const activeLightboxItem =
    lightboxIndex !== null && lightboxIndex >= 0 && lightboxIndex < activeGallery.length
      ? activeGallery[lightboxIndex]
      : null;
  const activeEntityName =
    kind === "persona" ? persona?.name : characterEntry?.record.name;

  const renderPersonaLightbox = () => {
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
    const loreEntries = persona.lore_entries ?? [];
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
          {/* Persistent Identity Header */}
          <div className="codex-detail-header codex-char-header">
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

              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="codex-detail-title-row">
                  <h3 className="codex-detail-title">{persona.name}</h3>
                </div>
                {persona.tagline?.trim() && (
                  <div className="codex-character-tagline">{persona.tagline}</div>
                )}
                {(persona.tags?.length ?? 0) > 0 && (
                  <div className="codex-chip-list codex-char-header-tags">
                    {persona.tags!.map((tag) => (
                      <span key={tag} className="badge codex-tag-chip">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                <div className="codex-badge-row" style={{ marginTop: 6 }}>
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

          {/* Live Campaign Physical State (when in campaign mode) */}
          {(personaTurnState || onOverridePlayerPhysicalState) && (
            <PhysicalStateControl
              label={persona.name}
              headerTitle="Current Physical State (Live)"
              stance={personaTurnState?.physical_stance}
              context={personaTurnState?.physical_context}
              variant="codex"
              isMutatingLocked={isMutatingLocked}
              onSave={onOverridePlayerPhysicalState}
              onOpenMechanicsHelp={
                onOpenMechanicsHelp
                  ? (topicId) =>
                      onOpenMechanicsHelp(topicId, {
                        kind: "persona",
                        personaId: persona.id,
                        label: persona.name,
                      })
                  : undefined
              }
            />
          )}

          {/* Persona Subtabs Bar */}
          <div className="codex-char-tabs" role="tablist" aria-label="Persona dossier sections">
            <div className="codex-char-tab-row">
              <button
                type="button"
                role="tab"
                aria-selected={activePersonaTab === "bio"}
                className={`codex-char-tab ${activePersonaTab === "bio" ? "active" : ""}`}
                onClick={() => setActivePersonaTab("bio")}
              >
                <BookOpen size={12} />
                <span>Bio</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePersonaTab === "appearance"}
                className={`codex-char-tab ${activePersonaTab === "appearance" ? "active" : ""}`}
                onClick={() => setActivePersonaTab("appearance")}
              >
                <Eye size={12} />
                <span>Appearance</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePersonaTab === "gear"}
                className={`codex-char-tab ${activePersonaTab === "gear" ? "active" : ""}`}
                onClick={() => setActivePersonaTab("gear")}
              >
                <Package size={12} />
                <span>Gear</span>
                <span className="codex-char-tab-badge">
                  {equipped.length + inventory.length}
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePersonaTab === "lore"}
                className={`codex-char-tab ${activePersonaTab === "lore" ? "active" : ""}`}
                onClick={() => setActivePersonaTab("lore")}
              >
                <ScrollText size={12} />
                <span>Lore &amp; Secrets</span>
                <span className="codex-char-tab-badge">{loreEntries.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activePersonaTab === "media"}
                className={`codex-char-tab ${activePersonaTab === "media" ? "active" : ""}`}
                onClick={() => setActivePersonaTab("media")}
              >
                <ImageIcon size={12} />
                <span>Media</span>
                <span className="codex-char-tab-badge">{gallery.length}</span>
              </button>
            </div>
          </div>

          {/* Persona Tab Panels */}
          <div className="codex-char-tab-panel">
            {activePersonaTab === "bio" && (
              <div className="codex-section-card">
                <div className="codex-section-label">Bio &amp; Concept</div>
                {persona.persona_bio?.trim() ? (
                  <p className="codex-prose-text">{persona.persona_bio}</p>
                ) : (
                  <div className="codex-muted-note">No biography recorded for this persona.</div>
                )}
              </div>
            )}

            {activePersonaTab === "appearance" && (
              <div className="codex-section-card">
                <div className="codex-section-label">Appearance</div>
                {!hasCanonicalAppearance && !legacyAppearance ? (
                  <div className="codex-muted-note">No appearance details recorded.</div>
                ) : (
                  <>
                    {persona.build_and_height?.trim() && (
                      <div className="codex-kv-line">
                        <span>{heightLabel}</span> {persona.build_and_height}
                      </div>
                    )}
                    {(persona.distinctive_features?.length ?? 0) > 0 && (
                      <div style={{ marginTop: 4 }}>
                        <div className="codex-sub-label">Distinctive Features</div>
                        <div className="codex-chip-list">
                          {persona.distinctive_features!.map((feat) => (
                            <span key={feat} className="badge codex-tag-chip">
                              {feat}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {legacyAppearance && <p className="codex-prose-text">{legacyAppearance}</p>}
                  </>
                )}
              </div>
            )}

            {activePersonaTab === "gear" && (
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
            )}

            {activePersonaTab === "lore" && (
              <div className="codex-section-card">
                <div className="codex-section-label">
                  Personal Lore &amp; Secrets ({loreEntries.length})
                </div>
                {loreEntries.length === 0 ? (
                  <div className="codex-muted-note">No personal lore or secrets recorded.</div>
                ) : (
                  <div className="codex-local-lore-list">
                    {loreEntries.map((entry) => (
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
                )}
              </div>
            )}

            {activePersonaTab === "media" && (
              <div className="codex-section-card">
                <div className="codex-section-label">
                  <ImageIcon size={12} /> Photo Album ({gallery.length})
                </div>
                {gallery.length === 0 ? (
                  <div className="codex-muted-note">No photos in this persona&apos;s album yet.</div>
                ) : (
                  <div className="codex-gallery-grid">
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
                        title={
                          img.video_url
                            ? `${img.caption || "Photo"} (video linked)`
                            : img.caption || "Inspect photo"
                        }
                      >
                        <img
                          src={img.url}
                          alt={img.caption || persona.name}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            display: "block",
                          }}
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
                )}
              </div>
            )}
          </div>
        </div>

        {renderPersonaLightbox()}
      </>
    );
  }

  if (kind === "character" && characterEntry) {
    const {
      record,
      state,
      isPresent,
      elsewhereLocationName,
      isPrimary,
      partyRole = null,
      partyName = null,
    } = characterEntry;

    const { equippedList, inventoryList } = splitLegacyWornItems(
      state?.equipped ?? record.equipped,
      state?.inventory ?? record.inventory
    );
    const totalInvCount = equippedList.length + inventoryList.length;
    const totalMediaCount =
      Object.keys(record.portraits ?? {}).length + (record.gallery ?? []).length;
    const temperamentMeta = getTemperamentPresetMeta(
      record.baseline_psyche.temperament?.archetype
    );
    const hasCreatorNotes = Boolean(record.creator_notes?.trim());
    const hasOpeningScene = Boolean(record.initial_message?.trim());
    const hasCanonicalAppearance =
      Boolean(record.build_and_height?.trim()) ||
      Boolean(record.posture?.trim()) ||
      Boolean(record.visual_aesthetic?.trim()) ||
      (record.distinctive_features?.length ?? 0) > 0 ||
      (record.mannerisms?.length ?? 0) > 0;
    const legacyAppearance =
      !hasCanonicalAppearance && record.physical_appearance?.trim()
        ? record.physical_appearance.trim()
        : "";

    return (
      <div className="codex-detail-stack">
        {/* Persistent Identity Header */}
        <div className="codex-detail-header codex-char-header">
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

            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="codex-detail-title-row">
                <h3 className="codex-detail-title">{record.name}</h3>
              </div>
              {record.tagline?.trim() && (
                <div className="codex-character-tagline">{record.tagline}</div>
              )}
              {(record.tags?.length ?? 0) > 0 && (
                <div className="codex-chip-list codex-char-header-tags">
                  {record.tags!.map((tag) => (
                    <span key={tag} className="badge codex-tag-chip">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <div className="codex-badge-row" style={{ marginTop: 6 }}>
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
                {partyRole === "player_party" && (
                  <span className="party-pill party-pill--player">
                    <Users size={10} />
                    {partyName || "In Party"}
                  </span>
                )}
                {(partyRole === "npc_party" || partyRole === "npc_leader") && (
                  <span className="party-pill party-pill--npc">
                    <Users size={10} />
                    {partyName || "NPC Party"}
                    {partyRole === "npc_leader" ? " · Leader" : ""}
                  </span>
                )}
                <span className="badge codex-badge--muted" title={temperamentMeta.summary}>
                  {temperamentMeta.label}
                </span>
                {record.species?.trim() && (
                  <span className="badge codex-badge--muted">{record.species}</span>
                )}
                {record.sex?.trim() && (
                  <span className="badge codex-badge--muted">{record.sex}</span>
                )}
                {record.pronouns?.trim() && (
                  <span className="badge codex-badge--muted">{record.pronouns}</span>
                )}
                {record.age?.trim() && (
                  <span className="badge codex-badge--muted">Age: {record.age}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Unified Two-Row Character Subtab Bar */}
        <div
          className="codex-char-tabs"
          role="tablist"
          aria-label="Character dossier sections"
        >
          <div className="codex-char-tab-row">
            <span className="codex-char-tab-row-label">Profile</span>
            <button
              type="button"
              role="tab"
              aria-selected={activeCharTab === "bio"}
              className={`codex-char-tab ${activeCharTab === "bio" ? "active" : ""}`}
              onClick={() => setActiveCharTab("bio")}
            >
              <BookOpen size={12} />
              <span>Bio</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeCharTab === "appearance"}
              className={`codex-char-tab ${activeCharTab === "appearance" ? "active" : ""}`}
              onClick={() => setActiveCharTab("appearance")}
            >
              <Eye size={12} />
              <span>Appearance</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeCharTab === "personality"}
              className={`codex-char-tab ${activeCharTab === "personality" ? "active" : ""}`}
              onClick={() => setActiveCharTab("personality")}
            >
              <Brain size={12} />
              <span>Personality</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeCharTab === "voice"}
              className={`codex-char-tab ${activeCharTab === "voice" ? "active" : ""}`}
              onClick={() => setActiveCharTab("voice")}
            >
              <MessageSquare size={12} />
              <span>Voice</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeCharTab === "media"}
              className={`codex-char-tab ${activeCharTab === "media" ? "active" : ""}`}
              onClick={() => setActiveCharTab("media")}
            >
              <ImageIcon size={12} />
              <span>Media</span>
              <span className="codex-char-tab-badge">{totalMediaCount}</span>
            </button>
          </div>

          <div className="codex-char-tab-row codex-char-tab-row--live">
            <span className="codex-char-tab-row-label">Live</span>
            {state && (
              <button
                type="button"
                role="tab"
                aria-selected={activeCharTab === "current"}
                className={`codex-char-tab codex-char-tab--live ${
                  activeCharTab === "current" ? "active" : ""
                }`}
                onClick={() => setActiveCharTab("current")}
              >
                <Activity
                  size={12}
                  color={activeCharTab === "current" ? "var(--accent-amber)" : undefined}
                />
                <span>Current</span>
                <span className="codex-char-tab-badge codex-char-tab-badge--live">
                  Live
                </span>
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={activeCharTab === "inventory"}
              className={`codex-char-tab codex-char-tab--live ${
                activeCharTab === "inventory" ? "active" : ""
              }`}
              onClick={() => setActiveCharTab("inventory")}
            >
              <Package size={12} />
              <span>Inventory</span>
              <span className="codex-char-tab-badge">{totalInvCount}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeCharTab === "memories"}
              className={`codex-char-tab codex-char-tab--live ${
                activeCharTab === "memories" ? "active" : ""
              }`}
              onClick={() => setActiveCharTab("memories")}
            >
              <Database size={12} />
              <span>Memories</span>
              <span className="codex-char-tab-badge">{memoryCount}</span>
            </button>
          </div>
        </div>

        {/* Subtab Content Panels */}
        <div className="codex-char-tab-panel">
          {activeCharTab === "bio" && (
            <>
              <div className="codex-section-card">
                <div className="codex-section-label">Public Biography</div>
                {record.character_bio?.trim() ? (
                  <p className="codex-prose-text">{record.character_bio}</p>
                ) : (
                  <div className="codex-muted-note">No biography recorded.</div>
                )}
              </div>

              {(hasCreatorNotes || hasOpeningScene) && (
                <>
                  <div className="codex-bio-actions">
                    {hasCreatorNotes && (
                      <button
                        type="button"
                        className={`btn btn-sm ${
                          activeBioDrawer === "creator_notes" ? "btn-amber" : ""
                        }`}
                        aria-expanded={activeBioDrawer === "creator_notes"}
                        onClick={() =>
                          setActiveBioDrawer((prev) =>
                            prev === "creator_notes" ? null : "creator_notes"
                          )
                        }
                      >
                        <ScrollText size={12} />
                        <span>Creator Notes</span>
                        {activeBioDrawer === "creator_notes" ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                      </button>
                    )}
                    {hasOpeningScene && (
                      <button
                        type="button"
                        className={`btn btn-sm ${
                          activeBioDrawer === "opening_scene" ? "btn-amber" : ""
                        }`}
                        aria-expanded={activeBioDrawer === "opening_scene"}
                        onClick={() =>
                          setActiveBioDrawer((prev) =>
                            prev === "opening_scene" ? null : "opening_scene"
                          )
                        }
                      >
                        <Sparkles size={12} />
                        <span>Opening Scene</span>
                        {activeBioDrawer === "opening_scene" ? (
                          <ChevronUp size={12} />
                        ) : (
                          <ChevronDown size={12} />
                        )}
                      </button>
                    )}
                  </div>

                  {activeBioDrawer === "creator_notes" && hasCreatorNotes && (
                    <div className="codex-bio-drawer">
                      <div className="codex-section-label">Creator Notes</div>
                      <p className="codex-prose-text">{record.creator_notes}</p>
                    </div>
                  )}

                  {activeBioDrawer === "opening_scene" && hasOpeningScene && (
                    <div className="codex-bio-drawer">
                      <div className="codex-section-label">Opening Scene</div>
                      <p className="codex-prose-text">{record.initial_message}</p>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {activeCharTab === "appearance" && (
            <div className="codex-section-card">
              <div className="codex-section-label">Appearance &amp; Bearing</div>
              {!hasCanonicalAppearance && !legacyAppearance ? (
                <div className="codex-muted-note">No appearance details recorded.</div>
              ) : (
                <>
                  {record.build_and_height?.trim() && (
                    <div className="codex-kv-line">
                      <span>Height:</span> {record.build_and_height}
                    </div>
                  )}
                  {record.posture?.trim() && (
                    <div className="codex-kv-line">
                      <span>Resting Posture:</span> {record.posture}
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
                      <div className="codex-sub-label">Mannerisms &amp; Behavioral Tells</div>
                      <ul className="codex-bullet-list">
                        {record.mannerisms!.map((tell, idx) => (
                          <li key={`${tell}-${idx}`}>{tell}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {legacyAppearance && <p className="codex-prose-text">{legacyAppearance}</p>}
                </>
              )}
            </div>
          )}

          {activeCharTab === "personality" && (
            <>
              <div className="codex-section-card">
                <div className="codex-section-label">Core Demeanor</div>
                {record.core_persona?.trim() ? (
                  <p className="codex-prose-text">{record.core_persona}</p>
                ) : (
                  <div className="codex-muted-note">No core demeanor recorded.</div>
                )}
              </div>

              {(record.personality_traits?.length ?? 0) > 0 && (
                <div className="codex-section-card">
                  <div className="codex-section-label">Traits</div>
                  <div className="codex-chip-list">
                    {record.personality_traits!.map((trait) => (
                      <span key={trait} className="badge codex-tag-chip">
                        {trait}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="codex-pers-split">
                <div className="codex-section-card">
                  <div className="codex-section-label">Moral Code &amp; Boundaries</div>
                  {(record.moral_code?.length ?? 0) > 0 ? (
                    <ul className="codex-bullet-list">
                      {record.moral_code!.map((rule, idx) => (
                        <li key={`${rule}-${idx}`}>{rule}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="codex-muted-note">No moral boundaries listed.</div>
                  )}
                </div>

                <div className="codex-section-card">
                  <div className="codex-section-label">Quirks &amp; Flaws</div>
                  {(record.quirks_flaws?.length ?? 0) > 0 ? (
                    <ul className="codex-bullet-list">
                      {record.quirks_flaws!.map((flaw, idx) => (
                        <li key={`${flaw}-${idx}`}>{flaw}</li>
                      ))}
                    </ul>
                  ) : (
                    <div className="codex-muted-note">No quirks or flaws listed.</div>
                  )}
                </div>
              </div>

              <div className="codex-section-card">
                <div
                  className="codex-section-label"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
                >
                  <span>Baseline Psyche &amp; Emotional Defaults</span>
                  <MechanicsHelpButton
                    topicId="care-worldview-temperament"
                    label="Worldview & Temperament"
                    onOpenHelp={
                      onOpenMechanicsHelp
                        ? (topicId) =>
                            onOpenMechanicsHelp(topicId, {
                              kind: "character",
                              characterId: record.id,
                              subtab: "personality",
                              label: `${record.name} (Personality)`,
                            })
                        : undefined
                    }
                  />
                </div>
                <div className="codex-psyche-grid">
                  <div>
                    <div className="codex-sub-label">Temperament</div>
                    <div className="codex-kv-line">
                      <strong>{temperamentMeta.label}</strong> — {temperamentMeta.summary}
                    </div>
                  </div>
                  <div>
                    <div className="codex-sub-label">Baseline Mood</div>
                    <div className="codex-kv-line">
                      <strong>{record.baseline_psyche.mood_label || "Neutral"}</strong> · Valence{" "}
                      {record.baseline_psyche.valence >= 0
                        ? `+${record.baseline_psyche.valence.toFixed(2)}`
                        : record.baseline_psyche.valence.toFixed(2)}{" "}
                      · Arousal {record.baseline_psyche.arousal.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="codex-sub-label">Core Drive</div>
                    <p className="codex-prose-text">
                      {record.baseline_psyche.core_drive || "—"}
                    </p>
                  </div>
                  <div>
                    <div className="codex-sub-label">Core Fear</div>
                    <p className="codex-prose-text">
                      {record.baseline_psyche.core_fear || "—"}
                    </p>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeCharTab === "voice" && (
            <>
              <div className="codex-section-card">
                <div className="codex-section-label">Communication Style</div>
                {(record.communication_style?.length ?? 0) > 0 ? (
                  <div className="codex-chip-list">
                    {record.communication_style!.map((style) => (
                      <span key={style} className="badge codex-tag-chip">
                        {style}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="codex-muted-note">No communication style keywords set.</div>
                )}
              </div>

              <div className="codex-section-card">
                <div className="codex-section-label">
                  Voice Anchors ({record.voice_anchors?.length ?? 0})
                </div>
                {(record.voice_anchors?.length ?? 0) > 0 ? (
                  <div className="codex-local-lore-list">
                    {record.voice_anchors.map((anchor, idx) => (
                      <div key={`${anchor.context}-${idx}`} className="codex-voice-anchor-card">
                        <div className="codex-sub-label">{anchor.context || `Anchor ${idx + 1}`}</div>
                        <p className="codex-prose-text">{anchor.snippet}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="codex-muted-note">No dialogue voice anchors recorded.</div>
                )}
              </div>
            </>
          )}

          <CampaignCharacterMemoriesTab
            characterId={record.id}
            initialShards={record.memory_shards}
            isActive={activeCharTab === "memories"}
            isMutatingLocked={isMutatingLocked}
            onMemoriesCountChange={setMemoryCount}
            onSaveMemories={onSaveMemories}
          />

          <CampaignCharacterInventoryTab
            character={record}
            equippedList={equippedList}
            inventoryList={inventoryList}
            worldArtifactNodes={worldArtifactNodes}
            activeWorldName={activeWorldName}
            isMutatingLocked={isMutatingLocked}
            initialExpandedItemId={null}
            isActive={activeCharTab === "inventory"}
            onItemAction={onItemAction}
            onJumpToLore={onJumpToLore}
          />

          {state && (
            <CampaignCharacterStateTab
              character={record}
              state={state}
              isPresent={Boolean(isPresent)}
              elsewhereLocationName={elsewhereLocationName}
              partyRole={partyRole}
              partyName={partyName}
              locations={locations}
              isMutatingLocked={isMutatingLocked}
              onRelocateCharacter={onRelocateCharacter}
              onOverridePhysicalState={
                onOverrideCharacterPhysicalState
                  ? (payload) => onOverrideCharacterPhysicalState(record.id, payload)
                  : undefined
              }
              characterNameMap={characterNameMap}
              personaSnapshot={persona}
              activeBranchTurns={activeBranchTurns}
              onOpenMechanicsHelp={
                onOpenMechanicsHelp
                  ? (topicId) =>
                      onOpenMechanicsHelp(topicId, {
                        kind: "character",
                        characterId: record.id,
                        subtab: "current",
                        label: `${record.name} (Current)`,
                      })
                  : undefined
              }
              isActive={activeCharTab === "current"}
            />
          )}

          <CampaignCharacterMediaTab
            character={record}
            isActive={activeCharTab === "media"}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="ui-empty-state ui-empty-state--fill">
      Select a character or persona on the left to inspect their dossier.
    </div>
  );
};
