import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Database,
  Edit3,
  Eye,
  FileText,
  Globe,
  History,
  Image as ImageIcon,
  Loader2,
  Lock,
  Maximize2,
  MessageSquare,
  Package,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  CharacterBaseTab,
  CharacterAppearanceTab,
  CharacterPersonalityTab,
  CharacterVoiceTab,
  CharacterBaseData,
  CharacterAppearanceData,
  CharacterPersonalityData,
  CharacterVoiceData,
} from "./character";
import {
  BasicEmotion,
  CharacterRecord,
  CharacterVersionSummary,
  CompassDirection,
  GalleryImage,
  ItemFlag,
  ItemInstance,
  LOCATION_LORE_CATEGORIES,
  LocationEdge,
  LocationEdgeDraft,
  LocationLoreCategory,
  LocationNode,
  LocationNodeDraft,
  LoreNode,
  MemoryShard,
  VoiceAnchor,
  WORLD_LORE_CATEGORIES,
  WorldGlobalRules,
  WorldLoreCategory,
  WorldRecord,
  WorldWizardDraft,
  hasItemFlag,
  normalizeItemList,
} from "../types";
import {
  OPPOSITE_COMPASS,
  SpatialTopologyView,
  inferCompassDirection,
  pickCompassSlot,
} from "./SpatialTopologyView";
import { TagChipsInput, normalizeTagList } from "./TagChipsInput";

export interface ClickToEditFieldProps {
  label?: string;
  readOnlyLabel?: string;
  value: string;
  onChange: (next: string) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  readOnly?: boolean;
  suggestions?: string[];
}

export const ClickToEditField: React.FC<ClickToEditFieldProps> = ({
  label,
  readOnlyLabel,
  value,
  onChange,
  multiline = false,
  rows = 3,
  placeholder = "Click to edit...",
  readOnly = false,
  suggestions,
}) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) {
      setDraft(value);
    }
  }, [value, editing]);

  const handleCommit = (commitVal?: string) => {
    setEditing(false);
    onChange(commitVal !== undefined ? commitVal : draft);
  };

  const displayLabel = (readOnly && readOnlyLabel) ? readOnlyLabel : label;

  return (
    <div className="field-group">
      {displayLabel && <label>{displayLabel}</label>}
      {editing && !readOnly ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {multiline ? (
            <textarea
              className="field-textarea"
              rows={rows}
              autoFocus
              value={draft}
              placeholder={placeholder}
              onChange={(e) => {
                setDraft(e.target.value);
                onChange(e.target.value);
              }}
              onBlur={() => handleCommit()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setDraft(value);
                  setEditing(false);
                }
              }}
            />
          ) : (
            <input
              className="field-input"
              autoFocus
              value={draft}
              placeholder={placeholder}
              onChange={(e) => {
                setDraft(e.target.value);
                onChange(e.target.value);
              }}
              onBlur={() => handleCommit()}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCommit();
                if (e.key === "Escape") {
                  setDraft(value);
                  setEditing(false);
                }
              }}
            />
          )}

          {suggestions && suggestions.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5, marginTop: 4 }}>
              <span style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginRight: 2 }}>
                Suggestions:
              </span>
              {suggestions.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  className="btn"
                  style={{
                    padding: "2px 7px",
                    fontSize: "0.68rem",
                    borderRadius: 4,
                    borderStyle: "dashed",
                    background: draft.toLowerCase() === sug.toLowerCase() ? "var(--accent-amber)" : "transparent",
                    color: draft.toLowerCase() === sug.toLowerCase() ? "#000" : "var(--text-secondary)",
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDraft(sug);
                    onChange(sug);
                  }}
                >
                  + {sug}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          className={`editable-field-box ${readOnly ? "read-only" : ""}`}
          onClick={() => {
            if (!readOnly) {
              setDraft(value);
              setEditing(true);
            }
          }}
          style={readOnly ? { cursor: "default" } : undefined}
          title={readOnly ? undefined : "Click to edit field"}
        >
          {!readOnly && (
            <span className="editable-field-hint">
              <Edit3 size={11} /> Click to edit
            </span>
          )}
          {value && value.trim().length > 0 ? (
            value
          ) : (
            <span style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
              {readOnly ? "—" : placeholder}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Character Inspector & Inline Editor Modal
// ============================================================================

export const BASIC_EMOTIONS: {
  key: BasicEmotion;
  label: string;
  description: string;
}[] = [
  { key: "default", label: "Default", description: "Standard neutral/baseline portrait" },
  { key: "happy", label: "Happy", description: "Joyful, smiling, amused" },
  { key: "sad", label: "Sad", description: "Melancholic, sorrowful, dejected" },
  { key: "afraid", label: "Afraid", description: "Fearful, startled, panicked" },
  { key: "angry", label: "Angry", description: "Furious, irritated, hostile" },
  { key: "disgusted", label: "Disgusted", description: "Repulsed, scornful, distaste" },
  { key: "surprised", label: "Surprised", description: "Astonished, wide-eyed, alert" },
  { key: "contempt", label: "Contempt", description: "Smug, disdainful, mocking" },
];

export async function cropToSquareBlob(file: File, maxDim: number = 512): Promise<Blob> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const minSide = Math.min(img.width, img.height);
        const targetSide = Math.min(minSide, maxDim);
        canvas.width = targetSide;
        canvas.height = targetSide;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, targetSide, targetSide);
        canvas.toBlob(
          (blob) => {
            if (blob) resolve(blob);
            else resolve(file);
          },
          "image/webp",
          0.9
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

interface CharacterInspectorModalProps {
  character: CharacterRecord;
  worlds: WorldRecord[];
  onClose: () => void;
  onSaved: (updated: CharacterRecord, closeModal?: boolean) => void;
}

type CharacterTab =
  | "base"
  | "appearance"
  | "personality"
  | "voice"
  | "memories"
  | "inventory"
  | "media";

export const CharacterInspectorModal: React.FC<
  CharacterInspectorModalProps
> = ({ character, worlds, onClose, onSaved }) => {
  const [activeTab, setActiveTab] = useState<CharacterTab>("base");
  const [name, setName] = useState(character.name);
  const [tagline, setTagline] = useState(character.tagline);
  const [worldId, setWorldId] = useState<string>(character.world_id ?? "");
  const [characterBio, setCharacterBio] = useState(
    character.character_bio ?? character.physical_appearance ?? ""
  );
  const [physicalAppearance, setPhysicalAppearance] = useState(
    character.physical_appearance ?? ""
  );
  const [species, setSpecies] = useState(character.species ?? "Human");
  const [sex, setSex] = useState(character.sex ?? "");
  const [pronouns, setPronouns] = useState(character.pronouns ?? "");
  const [age, setAge] = useState(character.age ?? "");
  const [buildAndHeight, setBuildAndHeight] = useState(
    character.build_and_height ?? ""
  );
  const initialFeatures = [
    ...(character.distinctive_features ?? []),
    ...(character.modifications ?? []).filter(
      (m) => !(character.distinctive_features ?? []).includes(m)
    ),
  ];
  const [distinctiveFeatures, setDistinctiveFeatures] = useState<string[]>(initialFeatures);
  const [posture, setPosture] = useState(character.posture ?? "");
  const [mannerisms, setMannerisms] = useState<string[]>(
    character.mannerisms ?? []
  );
  const [visualAesthetic, setVisualAesthetic] = useState(
    character.visual_aesthetic ?? ""
  );
  const [personalityTraits, setPersonalityTraits] = useState<string[]>(
    character.personality_traits ?? []
  );
  const [corePersona, setCorePersona] = useState(character.core_persona);
  const [moralCode, setMoralCode] = useState<string[]>(
    character.moral_code ?? []
  );
  const [quirksFlaws, setQuirksFlaws] = useState<string[]>(
    character.quirks_flaws ?? []
  );
  const [communicationStyle, setCommunicationStyle] = useState<string[]>(
    character.communication_style ?? []
  );
  const [initialMessage, setInitialMessage] = useState(
    character.initial_message ?? ""
  );
  const [equipped, setEquipped] = useState<ItemInstance[]>(() =>
    normalizeItemList(character.equipped)
  );
  const [inventory, setInventory] = useState<ItemInstance[]>(() =>
    normalizeItemList(character.inventory)
  );
  const [expandedTemplateItemKey, setExpandedTemplateItemKey] = useState<string | null>(null);
  const [baselinePsyche, setBaselinePsyche] = useState({
    ...character.baseline_psyche,
  });
  const [voiceAnchors, setVoiceAnchors] = useState<VoiceAnchor[]>(
    character.voice_anchors.map((v) => ({ ...v }))
  );
  const [memoryShards, setMemoryShards] = useState<MemoryShard[]>(
    character.memory_shards.map((m) => ({ ...m, keywords: [...m.keywords] }))
  );

  const [tags, setTags] = useState<string[]>(character.tags ?? []);
  const [creator, setCreator] = useState<string>(character.creator ?? "");
  const [creatorNotes, setCreatorNotes] = useState<string>(character.creator_notes ?? "");
  const [version, setVersion] = useState<number>(character.version ?? 1);

  // Media state
  const [portraits, setPortraits] = useState<Record<string, string>>(
    character.portraits ?? {}
  );
  const [gallery, setGallery] = useState<GalleryImage[]>(
    character.gallery ?? []
  );
  const [activeMediaSubTab, setActiveMediaSubTab] = useState<"portraits" | "gallery">("portraits");
  const [uploadingEmotion, setUploadingEmotion] = useState<string | null>(null);
  const [isUploadingGallery, setIsUploadingGallery] = useState<boolean>(false);
  const [galleryCaptionInput, setGalleryCaptionInput] = useState<string>("");
  const [lightboxImage, setLightboxImage] = useState<GalleryImage | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  // Version history state
  const [latestCharacter, setLatestCharacter] = useState<CharacterRecord>(character);
  const [characterId, setCharacterId] = useState<string>(character.id);
  const [versions, setVersions] = useState<CharacterVersionSummary[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number>(character.version ?? 1);
  const [viewingHistory, setViewingHistory] = useState<boolean>(false);
  const [historicalData, setHistoricalData] = useState<CharacterRecord | null>(null);
  const [loadingVersion, setLoadingVersion] = useState<boolean>(false);
  const [restoringVersion, setRestoringVersion] = useState<boolean>(false);

  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingChar, setExportingChar] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLatestCharacter(character);
    setCharacterId(character.id);
  }, [character]);

  const handleExportCharacter = async () => {
    setExportingChar(true);
    try {
      const includeWorld = character.world_id ? window.confirm("Include associated world in this export package?") : false;
      await api.exportCharacter(characterId, includeWorld);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setExportingChar(false);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLightboxImage(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    api.listCharacterVersions(characterId)
      .then((res) => {
        setVersions(res);
      })
      .catch((err) => console.warn("Failed to load versions", err));
  }, [characterId]);

  const handleSelectVersion = async (targetVer: number) => {
    if (isDirty) {
      if (!window.confirm("You have unsaved changes. Discard them to inspect a different version?")) {
        return;
      }
    }

    if (targetVer === version) {
      setViewingHistory(false);
      setSelectedVersion(version);
      setHistoricalData(null);
      setIsDirty(false);
      setName(latestCharacter.name);
      setTagline(latestCharacter.tagline);
      setWorldId(latestCharacter.world_id ?? "");
      setCharacterBio(latestCharacter.character_bio ?? latestCharacter.physical_appearance ?? "");
      setPhysicalAppearance(latestCharacter.physical_appearance ?? "");
      setSpecies(latestCharacter.species ?? "Human");
      setSex(latestCharacter.sex ?? "");
      setPronouns(latestCharacter.pronouns ?? "");
      setAge(latestCharacter.age ?? "");
      setBuildAndHeight(latestCharacter.build_and_height ?? "");
      const characterMergedFeatures = [
        ...(latestCharacter.distinctive_features ?? []),
        ...(latestCharacter.modifications ?? []).filter(
          (m) => !(latestCharacter.distinctive_features ?? []).includes(m)
        ),
      ];
      setDistinctiveFeatures(characterMergedFeatures);
      setPosture(latestCharacter.posture ?? "");
      setMannerisms(latestCharacter.mannerisms ?? []);
      setVisualAesthetic(latestCharacter.visual_aesthetic ?? "");
      setPersonalityTraits(latestCharacter.personality_traits ?? []);
      setCorePersona(latestCharacter.core_persona);
      setMoralCode(latestCharacter.moral_code ?? []);
      setQuirksFlaws(latestCharacter.quirks_flaws ?? []);
      setCommunicationStyle(latestCharacter.communication_style ?? []);
      setInitialMessage(latestCharacter.initial_message ?? "");
      setEquipped(normalizeItemList(latestCharacter.equipped));
      setInventory(normalizeItemList(latestCharacter.inventory));
      setBaselinePsyche({ ...latestCharacter.baseline_psyche });
      setVoiceAnchors(latestCharacter.voice_anchors.map((v) => ({ ...v })));
      setMemoryShards(latestCharacter.memory_shards.map((m) => ({ ...m, keywords: [...m.keywords] })));
      setTags(latestCharacter.tags ?? []);
      setCreator(latestCharacter.creator ?? "");
      setCreatorNotes(latestCharacter.creator_notes ?? "");
      setPortraits(latestCharacter.portraits ?? {});
      setGallery(latestCharacter.gallery ?? []);
      return;
    }

    setLoadingVersion(true);
    setError(null);
    try {
      const snap = await api.getCharacterVersion(characterId, targetVer);
      setHistoricalData(snap);
      setSelectedVersion(targetVer);
      setViewingHistory(true);
      setIsDirty(false);
      setName(snap.name);
      setTagline(snap.tagline);
      setWorldId(snap.world_id ?? "");
      setCharacterBio(snap.character_bio ?? snap.physical_appearance ?? "");
      setPhysicalAppearance(snap.physical_appearance ?? "");
      setSpecies(snap.species ?? "Human");
      setSex(snap.sex ?? "");
      setPronouns(snap.pronouns ?? "");
      setAge(snap.age ?? "");
      setBuildAndHeight(snap.build_and_height ?? "");
      const snapMergedFeatures = [
        ...(snap.distinctive_features ?? []),
        ...(snap.modifications ?? []).filter(
          (m) => !(snap.distinctive_features ?? []).includes(m)
        ),
      ];
      setDistinctiveFeatures(snapMergedFeatures);
      setPosture(snap.posture ?? "");
      setMannerisms(snap.mannerisms ?? []);
      setVisualAesthetic(snap.visual_aesthetic ?? "");
      setPersonalityTraits(snap.personality_traits ?? []);
      setCorePersona(snap.core_persona);
      setMoralCode(snap.moral_code ?? []);
      setQuirksFlaws(snap.quirks_flaws ?? []);
      setCommunicationStyle(snap.communication_style ?? []);
      setInitialMessage(snap.initial_message ?? "");
      setEquipped(normalizeItemList(snap.equipped));
      setInventory(normalizeItemList(snap.inventory));
      setBaselinePsyche({ ...snap.baseline_psyche });
      setVoiceAnchors(snap.voice_anchors.map((v) => ({ ...v })));
      setMemoryShards(snap.memory_shards.map((m) => ({ ...m, keywords: [...m.keywords] })));
      setTags(snap.tags ?? []);
      setCreator(snap.creator ?? "");
      setCreatorNotes(snap.creator_notes ?? "");
      setPortraits(snap.portraits ?? latestCharacter.portraits ?? {});
      setGallery(snap.gallery ?? latestCharacter.gallery ?? []);
    } catch (err) {
      setError(`Failed to fetch version ${targetVer}: ${String(err)}`);
    } finally {
      setLoadingVersion(false);
    }
  };

  const handleExitHistory = () => {
    handleSelectVersion(version);
  };

  const handleRestoreHistoricalVersion = async () => {
    if (!historicalData) return;
    const targetVer = historicalData.version;
    setRestoringVersion(true);
    setError(null);
    try {
      const updated = await api.restoreCharacterVersion(characterId, targetVer);
      setLatestCharacter(updated);
      setCharacterId(updated.id);
      setVersion(updated.version);
      setSelectedVersion(updated.version);
      setViewingHistory(false);
      setHistoricalData(null);
      setIsDirty(false);

      setName(updated.name);
      setTagline(updated.tagline);
      setWorldId(updated.world_id ?? "");
      setCharacterBio(updated.character_bio ?? updated.physical_appearance ?? "");
      setPhysicalAppearance(updated.physical_appearance ?? "");
      setSpecies(updated.species ?? "Human");
      setSex(updated.sex ?? "");
      setPronouns(updated.pronouns ?? "");
      setAge(updated.age ?? "");
      setBuildAndHeight(updated.build_and_height ?? "");
      const updatedFeatures = [
        ...(updated.distinctive_features ?? []),
        ...(updated.modifications ?? []).filter(
          (m) => !(updated.distinctive_features ?? []).includes(m)
        ),
      ];
      setDistinctiveFeatures(updatedFeatures);
      setPosture(updated.posture ?? "");
      setMannerisms(updated.mannerisms ?? []);
      setVisualAesthetic(updated.visual_aesthetic ?? "");
      setPersonalityTraits(updated.personality_traits ?? []);
      setCorePersona(updated.core_persona);
      setMoralCode(updated.moral_code ?? []);
      setQuirksFlaws(updated.quirks_flaws ?? []);
      setCommunicationStyle(updated.communication_style ?? []);
      setInitialMessage(updated.initial_message ?? "");
      setEquipped(normalizeItemList(updated.equipped));
      setInventory(normalizeItemList(updated.inventory));
      setBaselinePsyche({ ...updated.baseline_psyche });
      setVoiceAnchors(updated.voice_anchors.map((v) => ({ ...v })));
      setMemoryShards(updated.memory_shards.map((m) => ({ ...m, keywords: [...m.keywords] })));
      setTags(updated.tags ?? []);
      setCreator(updated.creator ?? "");
      setCreatorNotes(updated.creator_notes ?? "");
      setPortraits(updated.portraits ?? {});
      setGallery(updated.gallery ?? []);

      const nextVersions = await api.listCharacterVersions(updated.id);
      setVersions(nextVersions);

      onSaved(updated, false);
    } catch (err: any) {
      setError(err?.message || `Failed to restore version ${targetVer}: ${String(err)}`);
    } finally {
      setRestoringVersion(false);
    }
  };

  const markDirty = () => {
    if (!isDirty) setIsDirty(true);
  };

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

  const selectedWorldObj = worlds.find((w) => w.id === worldId);
  const selectedWorldArtifacts = (selectedWorldObj?.lore_nodes ?? []).filter(
    (ln) => ln.category === "artifact" && !ln.location_id
  );
  const selectedWorldArtifactIds = new Set(selectedWorldArtifacts.map((ln) => ln.id));
  const selectedWorldArtifactTitleMap = new Map(
    selectedWorldArtifacts.map((ln) => [ln.id, ln.title])
  );

  const sanitizeItemsForSave = (list: ItemInstance[]): ItemInstance[] =>
    list
      .map((it) => {
        const cleanName = it.name.trim();
        const validArtifact =
          hasItemFlag(it, "artifact") &&
          Boolean(it.lore_id) &&
          selectedWorldArtifactIds.has(it.lore_id as string);
        const cleanFlags: ItemFlag[] = [];
        if (hasItemFlag(it, "permanent")) cleanFlags.push("permanent");
        if (validArtifact) cleanFlags.push("artifact");
        return {
          ...it,
          name: cleanName,
          note: (it.note ?? "").trim().slice(0, 300),
          flags: cleanFlags,
          lore_id: validArtifact ? it.lore_id ?? null : null,
        };
      })
      .filter((it) => it.name.length > 0);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const cleanEquipped = sanitizeItemsForSave(equipped);
      const cleanInventory = sanitizeItemsForSave(inventory);
      const updated = await api.updateCharacter(characterId, {
        name: name.trim() || latestCharacter.name,
        tagline: tagline.trim(),
        character_bio: characterBio.trim(),
        physical_appearance: (characterBio.trim() || physicalAppearance.trim()),
        species: species.trim() || "Human",
        sex: sex.trim(),
        pronouns: pronouns.trim(),
        age: age.trim(),
        build_and_height: buildAndHeight.trim(),
        distinctive_features: distinctiveFeatures,
        posture: posture.trim(),
        mannerisms: mannerisms.map((m) => m.trim()).filter(Boolean),
        modifications: [],
        visual_aesthetic: visualAesthetic.trim(),
        personality_traits: personalityTraits,
        core_persona: corePersona.trim(),
        moral_code: moralCode,
        quirks_flaws: quirksFlaws,
        communication_style: communicationStyle,
        initial_message: initialMessage.trim(),
        equipped: cleanEquipped,
        inventory: cleanInventory,
        voice_anchors: voiceAnchors,
        baseline_psyche: baselinePsyche,
        memory_shards: memoryShards,
        tags: tags,
        creator: creator.trim(),
        creator_notes: creatorNotes.trim(),
        portraits: portraits,
        gallery: gallery,
        world_id: worldId || null,
      });
      setLatestCharacter(updated);
      setCharacterId(updated.id);
      setEquipped(normalizeItemList(updated.equipped));
      setInventory(normalizeItemList(updated.inventory));
      setVersion(updated.version);
      setSelectedVersion(updated.version);
      setIsDirty(false);
      api.listCharacterVersions(updated.id).then(setVersions).catch(() => {});
      onSaved(updated, true);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleBaseChange = (updated: Partial<CharacterBaseData>) => {
    markDirty();
    if (updated.name !== undefined) setName(updated.name);
    if (updated.tagline !== undefined) setTagline(updated.tagline);
    if (updated.character_bio !== undefined) {
      setCharacterBio(updated.character_bio);
      setPhysicalAppearance(updated.character_bio);
    }
    if (updated.physical_appearance !== undefined) {
      setPhysicalAppearance(updated.physical_appearance);
      setCharacterBio(updated.physical_appearance);
    }
    if (updated.species !== undefined) setSpecies(updated.species);
    if (updated.sex !== undefined) setSex(updated.sex);
    if (updated.pronouns !== undefined) setPronouns(updated.pronouns);
    if (updated.age !== undefined) setAge(updated.age);
    if (updated.initial_message !== undefined) setInitialMessage(updated.initial_message);
    if (updated.creator !== undefined) setCreator(updated.creator);
    if (updated.creator_notes !== undefined) setCreatorNotes(updated.creator_notes);
    if (updated.tags !== undefined) {
      setTags(updated.tags);
    }
    if (updated.world_id !== undefined) {
      const nextWorldId = updated.world_id;
      const nextWorld = worlds.find((w) => w.id === nextWorldId);
      const nextArtIds = new Set(
        (nextWorld?.lore_nodes ?? [])
          .filter((ln) => ln.category === "artifact" && !ln.location_id)
          .map((ln) => ln.id)
      );
      const unlinkForeignArtifacts = (items: ItemInstance[]): ItemInstance[] =>
        items.map((it) => {
          if (it.lore_id && nextArtIds.has(it.lore_id)) return it;
          return {
            ...it,
            flags: it.flags.filter((f) => f !== "artifact"),
            lore_id: null,
          };
        });
      setWorldId(nextWorldId ?? "");
      setEquipped((prev) => unlinkForeignArtifacts(prev));
      setInventory((prev) => unlinkForeignArtifacts(prev));
    }
  };

  const handleAppearanceChange = (updated: Partial<CharacterAppearanceData>) => {
    markDirty();
    if (updated.character_bio !== undefined) setCharacterBio(updated.character_bio);
    if (updated.physical_appearance !== undefined) setPhysicalAppearance(updated.physical_appearance);
    if (updated.build_and_height !== undefined) setBuildAndHeight(updated.build_and_height);
    if (updated.distinctive_features !== undefined) setDistinctiveFeatures(updated.distinctive_features);
    if (updated.posture !== undefined) setPosture(updated.posture);
    if (updated.mannerisms !== undefined) setMannerisms(updated.mannerisms);
    if (updated.modifications !== undefined && updated.modifications.length > 0) {
      setDistinctiveFeatures((prev) => [
        ...prev,
        ...updated.modifications!.filter((m) => !prev.includes(m)),
      ]);
    }
    if (updated.visual_aesthetic !== undefined) setVisualAesthetic(updated.visual_aesthetic);
  };

  const handlePersonalityChange = (updated: Partial<CharacterPersonalityData>) => {
    markDirty();
    if (updated.personality_traits !== undefined) setPersonalityTraits(updated.personality_traits);
    if (updated.core_persona !== undefined) setCorePersona(updated.core_persona);
    if (updated.moral_code !== undefined) setMoralCode(updated.moral_code);
    if (updated.quirks_flaws !== undefined) setQuirksFlaws(updated.quirks_flaws);
    if (updated.baseline_psyche !== undefined) setBaselinePsyche(updated.baseline_psyche);
  };

  const handleVoiceChange = (updated: Partial<CharacterVoiceData>) => {
    markDirty();
    if (updated.communication_style !== undefined) setCommunicationStyle(updated.communication_style);
    if (updated.voice_anchors !== undefined) setVoiceAnchors(updated.voice_anchors);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        style={{ width: "min(820px, 95vw)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Users size={18} color="var(--accent-amber)" />
              Character Sheet
            </span>
            <span
              style={{
                fontSize: "0.72rem",
                background: "rgba(245, 158, 11, 0.15)",
                color: "var(--accent-amber)",
                padding: "2px 7px",
                borderRadius: 4,
                fontWeight: 600,
              }}
            >
              v{viewingHistory && historicalData ? historicalData.version : version}
            </span>
            {versions.length > 1 && (
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <History size={13} color="var(--text-muted)" />
                <select
                  className="field-select"
                  style={{
                    padding: "2px 8px",
                    fontSize: "0.72rem",
                    height: "auto",
                    width: "auto",
                  }}
                  value={selectedVersion}
                  disabled={loadingVersion || restoringVersion}
                  onChange={(e) => handleSelectVersion(Number(e.target.value))}
                >
                  {versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      v{v.version} {v.version === version ? "(Active)" : `(${new Date(v.created_at).toLocaleDateString()})`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        {viewingHistory && historicalData && (
          <div
            style={{
              background: "rgba(59, 130, 246, 0.12)",
              border: "1px solid rgba(59, 130, 246, 0.3)",
              margin: "12px 16px 0",
              padding: "8px 12px",
              borderRadius: 6,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "0.78rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <History size={15} color="#60a5fa" />
              <span>
                Viewing historical <strong>Version {historicalData.version}</strong> (Read Only)
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn"
                style={{ fontSize: "0.72rem", padding: "3px 8px" }}
                disabled={restoringVersion}
                onClick={handleExitHistory}
              >
                Back to Active (v{version})
              </button>
              <button
                type="button"
                className="btn btn-amber"
                style={{ fontSize: "0.72rem", padding: "3px 8px", display: "inline-flex", alignItems: "center", gap: 5 }}
                disabled={restoringVersion}
                onClick={handleRestoreHistoricalVersion}
              >
                {restoringVersion ? (
                  <>
                    <Loader2 size={12} className="spin" /> Activating...
                  </>
                ) : (
                  "Set as Active"
                )}
              </button>
            </div>
          </div>
        )}

        <div className="modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "base"}
            className={`modal-tab-btn ${activeTab === "base" ? "active" : ""}`}
            onClick={() => setActiveTab("base")}
          >
            <User size={14} />
            <span>Base</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "appearance"}
            className={`modal-tab-btn ${activeTab === "appearance" ? "active" : ""}`}
            onClick={() => setActiveTab("appearance")}
          >
            <Eye size={14} />
            <span>Appearance</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "personality"}
            className={`modal-tab-btn ${activeTab === "personality" ? "active" : ""}`}
            onClick={() => setActiveTab("personality")}
          >
            <Brain size={14} />
            <span>Personality</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "voice"}
            className={`modal-tab-btn ${activeTab === "voice" ? "active" : ""}`}
            onClick={() => setActiveTab("voice")}
          >
            <MessageSquare size={14} />
            <span>Voice & Dialogue</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "memories"}
            className={`modal-tab-btn ${activeTab === "memories" ? "active" : ""}`}
            onClick={() => setActiveTab("memories")}
          >
            <Database size={14} />
            <span>Memories</span>
            <span className="modal-tab-badge">{memoryShards.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "inventory"}
            className={`modal-tab-btn ${activeTab === "inventory" ? "active" : ""}`}
            onClick={() => setActiveTab("inventory")}
          >
            <Package size={14} />
            <span>Inventory</span>
            <span className="modal-tab-badge">{equipped.length + inventory.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "media"}
            className={`modal-tab-btn ${activeTab === "media" ? "active" : ""}`}
            onClick={() => setActiveTab("media")}
          >
            <ImageIcon size={14} />
            <span>Media</span>
            <span className="modal-tab-badge">
              {Object.keys(portraits).length + gallery.length}
            </span>
          </button>
        </div>

        <div className="modal-body">
          {/* Base Tab */}
          <div
            style={{
              display: activeTab === "base" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: "0.76rem",
                color: "var(--text-secondary)",
                background: "var(--bg-card)",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-subtle)",
              }}
            >
              Click on any field below to edit it. Active campaigns using this
              character remain pinned to their original snapshot automatically.
            </div>

            <CharacterBaseTab
              data={{
                name,
                tagline,
                world_id: worldId,
                character_bio: characterBio,
                physical_appearance: physicalAppearance,
                species,
                sex,
                pronouns,
                age,
                initial_message: initialMessage,
                creator,
                creator_notes: creatorNotes,
                tags,
              }}
              onChange={handleBaseChange}
              readOnly={viewingHistory}
              worlds={worlds}
            />
          </div>

          {/* Appearance Tab */}
          <div
            style={{
              display: activeTab === "appearance" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <CharacterAppearanceTab
              data={{
                character_bio: characterBio,
                physical_appearance: physicalAppearance,
                build_and_height: buildAndHeight,
                distinctive_features: distinctiveFeatures,
                posture,
                mannerisms,
                visual_aesthetic: visualAesthetic,
              }}
              onChange={handleAppearanceChange}
              readOnly={viewingHistory}
            />
          </div>

          {/* Personality Tab */}
          <div
            style={{
              display: activeTab === "personality" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <CharacterPersonalityTab
              data={{
                personality_traits: personalityTraits,
                core_persona: corePersona,
                moral_code: moralCode,
                quirks_flaws: quirksFlaws,
                baseline_psyche: baselinePsyche,
              }}
              onChange={handlePersonalityChange}
              readOnly={viewingHistory}
            />
          </div>

          {/* Voice Tab */}
          <div
            style={{
              display: activeTab === "voice" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <CharacterVoiceTab
              data={{
                communication_style: communicationStyle,
                voice_anchors: voiceAnchors,
              }}
              onChange={handleVoiceChange}
              readOnly={viewingHistory}
            />
          </div>

          {/* Memories Tab */}
          <div
            style={{
              display: activeTab === "memories" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="sidebar-label">
                  Backstory Memory Shards — Hybrid GraphRAG ({memoryShards.length})
                </span>
                {!viewingHistory && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                    onClick={() => {
                      setMemoryShards([
                        ...memoryShards,
                        {
                          title: "New Backstory Memory",
                          content: "Describe a key memory or secret...",
                          keywords: [],
                          emotional_weight: 0.7,
                        },
                      ]);
                      markDirty();
                    }}
                  >
                    <Plus size={12} /> Add Memory Shard
                  </button>
                )}
              </div>

              {memoryShards.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No backstory memory shards indexed. Add shards to anchor GraphRAG retrieval during narrative turns.
                </div>
              ) : (
                memoryShards.map((shard, idx) => (
                  <div
                    key={idx}
                    style={{
                      background: "var(--bg-panel)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 6,
                      padding: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: viewingHistory ? "1fr 1fr" : "1fr 1fr auto",
                        gap: 8,
                        alignItems: "start",
                      }}
                    >
                      <ClickToEditField
                        label="Shard Title"
                        value={shard.title}
                        readOnly={viewingHistory}
                        onChange={(val) => {
                          const next = [...memoryShards];
                          next[idx] = { ...next[idx], title: val };
                          setMemoryShards(next);
                          markDirty();
                        }}
                      />
                      <ClickToEditField
                        label="Trigger Keywords (comma-separated)"
                        value={shard.keywords.join(", ")}
                        placeholder="e.g. dragon, betrayal, upper spire"
                        readOnly={viewingHistory}
                        onChange={(val) => {
                          const next = [...memoryShards];
                          next[idx] = {
                            ...next[idx],
                            keywords: val
                              .split(",")
                              .map((k) => k.trim())
                              .filter(Boolean),
                          };
                          setMemoryShards(next);
                          markDirty();
                        }}
                      />
                      {!viewingHistory && (
                        <button
                          type="button"
                          className="item-remove-btn"
                          style={{ marginTop: 22 }}
                          onClick={() => {
                            setMemoryShards(
                              memoryShards.filter((_, i) => i !== idx)
                            );
                            markDirty();
                          }}
                          title="Remove memory shard"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>

                    <ClickToEditField
                      label="Memory Content"
                      value={shard.content}
                      readOnly={viewingHistory}
                      multiline
                      rows={2}
                      onChange={(val) => {
                        const next = [...memoryShards];
                        next[idx] = { ...next[idx], content: val };
                        setMemoryShards(next);
                        markDirty();
                      }}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Inventory Tab */}
          <div
            style={{
              display: activeTab === "inventory" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* Equipped Attire */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="sidebar-label">
                  Equipped Attire &amp; Gear ({equipped.length})
                </span>
                {!viewingHistory && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                    onClick={() => {
                      const newId = `tpl_eq_${Date.now()}`;
                      setEquipped([
                        ...equipped,
                        {
                          id: newId,
                          name: "New equipped attire",
                          note: "",
                          flags: [],
                          lore_id: null,
                        },
                      ]);
                      markDirty();
                    }}
                  >
                    <Plus size={12} /> Add Equipped
                  </button>
                )}
              </div>

              {equipped.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No starting attire or worn gear specified.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {equipped.map((item, idx) => {
                    const rowKey = `eq:${item.id || idx}`;
                    const isExpanded = expandedTemplateItemKey === rowKey;
                    const isPerm = hasItemFlag(item, "permanent");
                    const isArt = hasItemFlag(item, "artifact");
                    const hasNote = Boolean(item.note && item.note.trim());
                    return (
                      <div
                        key={rowKey}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          padding: 6,
                          borderRadius: 6,
                          border: isExpanded
                            ? "1px solid var(--accent-amber)"
                            : "1px solid var(--border-subtle)",
                          background: "var(--bg-panel)",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: viewingHistory ? "1fr" : "1fr auto auto",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <ClickToEditField
                            value={item.name}
                            readOnly={viewingHistory}
                            placeholder="e.g. Weathered leather duster"
                            onChange={(val) => {
                              const next = [...equipped];
                              next[idx] = { ...next[idx], name: val };
                              setEquipped(next);
                              markDirty();
                            }}
                          />
                          {!viewingHistory && (
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "4px 8px", fontSize: "0.7rem" }}
                              title="Edit starting item mini-lore & flags"
                              onClick={() =>
                                setExpandedTemplateItemKey(isExpanded ? null : rowKey)
                              }
                            >
                              {isPerm && <Lock size={10} color="#7dd3fc" />}
                              {isArt && <Sparkles size={10} color="#d8b4fe" />}
                              {hasNote && <FileText size={10} color="var(--accent-amber)" />}
                              <span>Lore &amp; Flags</span>
                              {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                          )}
                          {!viewingHistory && (
                            <button
                              type="button"
                              className="item-remove-btn"
                              onClick={() => {
                                setEquipped(equipped.filter((_, i) => i !== idx));
                                markDirty();
                              }}
                              title="Remove equipped item"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        {(isPerm || isArt || hasNote) && !isExpanded && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 4 }}>
                            {isPerm && (
                              <span className="item-flag-pill item-flag-permanent">
                                <Lock size={10} /> Permanent
                              </span>
                            )}
                            {isArt && (
                              <span className="item-flag-pill item-flag-artifact">
                                <Sparkles size={10} />{" "}
                                {item.lore_id && selectedWorldArtifactTitleMap.get(item.lore_id)
                                  ? `Artifact · ${selectedWorldArtifactTitleMap.get(item.lore_id)}`
                                  : "Artifact"}
                              </span>
                            )}
                            {hasNote && (
                              <span className="item-flag-pill item-flag-note" title={item.note}>
                                <FileText size={10} /> {item.note}
                              </span>
                            )}
                          </div>
                        )}
                        {isExpanded && !viewingHistory && (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                              padding: "8px 6px 4px",
                              borderTop: "1px solid var(--border-subtle)",
                            }}
                          >
                            <div className="field-group">
                              <label>
                                Mini-Lore Note ({item.note.length}/300)
                              </label>
                              <textarea
                                className="field-textarea"
                                rows={2}
                                maxLength={300}
                                placeholder="Brief item history or sensory detail..."
                                value={item.note}
                                onChange={(e) => {
                                  const next = [...equipped];
                                  next[idx] = { ...next[idx], note: e.target.value };
                                  setEquipped(next);
                                  markDirty();
                                }}
                              />
                            </div>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.75rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={isPerm}
                                  onChange={(e) => {
                                    const nextFlags = e.target.checked
                                      ? Array.from(new Set<ItemFlag>([...item.flags, "permanent"]))
                                      : item.flags.filter((f) => f !== "permanent");
                                    const next = [...equipped];
                                    next[idx] = { ...next[idx], flags: nextFlags };
                                    setEquipped(next);
                                    markDirty();
                                  }}
                                />
                                <Lock size={11} color="#7dd3fc" /> Permanent
                              </label>
                              {worldId && selectedWorldArtifacts.length > 0 && (
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.75rem", cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={isArt}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      const nextFlags = checked
                                        ? Array.from(new Set<ItemFlag>([...item.flags, "artifact"]))
                                        : item.flags.filter((f) => f !== "artifact");
                                      const next = [...equipped];
                                      next[idx] = {
                                        ...next[idx],
                                        flags: nextFlags,
                                        lore_id: checked
                                          ? item.lore_id || selectedWorldArtifacts[0].id
                                          : null,
                                      };
                                      setEquipped(next);
                                      markDirty();
                                    }}
                                  />
                                  <Sparkles size={11} color="#d8b4fe" /> World Artifact
                                </label>
                              )}
                              {isArt && worldId && selectedWorldArtifacts.length > 0 && (
                                <select
                                  className="field-select"
                                  style={{ width: "auto", minWidth: 200, fontSize: "0.74rem" }}
                                  value={item.lore_id || ""}
                                  onChange={(e) => {
                                    const next = [...equipped];
                                    next[idx] = { ...next[idx], lore_id: e.target.value || null };
                                    setEquipped(next);
                                    markDirty();
                                  }}
                                >
                                  {selectedWorldArtifacts.map((ln) => (
                                    <option key={ln.id} value={ln.id}>
                                      {ln.title}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Carried Inventory */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span className="sidebar-label">
                  Carried Inventory &amp; Objects ({inventory.length})
                </span>
                {!viewingHistory && (
                  <button
                    type="button"
                    className="btn"
                    style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                    onClick={() => {
                      const newId = `tpl_inv_${Date.now()}`;
                      setInventory([
                        ...inventory,
                        {
                          id: newId,
                          name: "New carried item",
                          note: "",
                          flags: [],
                          lore_id: null,
                        },
                      ]);
                      markDirty();
                    }}
                  >
                    <Plus size={12} /> Add Item
                  </button>
                )}
              </div>

              {inventory.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No starting carried items specified.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {inventory.map((item, idx) => {
                    const rowKey = `inv:${item.id || idx}`;
                    const isExpanded = expandedTemplateItemKey === rowKey;
                    const isPerm = hasItemFlag(item, "permanent");
                    const isArt = hasItemFlag(item, "artifact");
                    const hasNote = Boolean(item.note && item.note.trim());
                    return (
                      <div
                        key={rowKey}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 6,
                          padding: 6,
                          borderRadius: 6,
                          border: isExpanded
                            ? "1px solid var(--accent-amber)"
                            : "1px solid var(--border-subtle)",
                          background: "var(--bg-panel)",
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: viewingHistory ? "1fr" : "1fr auto auto",
                            gap: 6,
                            alignItems: "center",
                          }}
                        >
                          <ClickToEditField
                            value={item.name}
                            readOnly={viewingHistory}
                            placeholder="e.g. Diagnostic scanner or Keycard"
                            onChange={(val) => {
                              const next = [...inventory];
                              next[idx] = { ...next[idx], name: val };
                              setInventory(next);
                              markDirty();
                            }}
                          />
                          {!viewingHistory && (
                            <button
                              type="button"
                              className="btn"
                              style={{ padding: "4px 8px", fontSize: "0.7rem" }}
                              title="Edit starting item mini-lore & flags"
                              onClick={() =>
                                setExpandedTemplateItemKey(isExpanded ? null : rowKey)
                              }
                            >
                              {isPerm && <Lock size={10} color="#7dd3fc" />}
                              {isArt && <Sparkles size={10} color="#d8b4fe" />}
                              {hasNote && <FileText size={10} color="var(--accent-amber)" />}
                              <span>Lore &amp; Flags</span>
                              {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                            </button>
                          )}
                          {!viewingHistory && (
                            <button
                              type="button"
                              className="item-remove-btn"
                              onClick={() => {
                                setInventory(inventory.filter((_, i) => i !== idx));
                                markDirty();
                              }}
                              title="Remove item"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                        {(isPerm || isArt || hasNote) && !isExpanded && (
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 4 }}>
                            {isPerm && (
                              <span className="item-flag-pill item-flag-permanent">
                                <Lock size={10} /> Permanent
                              </span>
                            )}
                            {isArt && (
                              <span className="item-flag-pill item-flag-artifact">
                                <Sparkles size={10} />{" "}
                                {item.lore_id && selectedWorldArtifactTitleMap.get(item.lore_id)
                                  ? `Artifact · ${selectedWorldArtifactTitleMap.get(item.lore_id)}`
                                  : "Artifact"}
                              </span>
                            )}
                            {hasNote && (
                              <span className="item-flag-pill item-flag-note" title={item.note}>
                                <FileText size={10} /> {item.note}
                              </span>
                            )}
                          </div>
                        )}
                        {isExpanded && !viewingHistory && (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 8,
                              padding: "8px 6px 4px",
                              borderTop: "1px solid var(--border-subtle)",
                            }}
                          >
                            <div className="field-group">
                              <label>
                                Mini-Lore Note ({item.note.length}/300)
                              </label>
                              <textarea
                                className="field-textarea"
                                rows={2}
                                maxLength={300}
                                placeholder="Brief item history or sensory detail..."
                                value={item.note}
                                onChange={(e) => {
                                  const next = [...inventory];
                                  next[idx] = { ...next[idx], note: e.target.value };
                                  setInventory(next);
                                  markDirty();
                                }}
                              />
                            </div>
                            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                              <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.75rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={isPerm}
                                  onChange={(e) => {
                                    const nextFlags = e.target.checked
                                      ? Array.from(new Set<ItemFlag>([...item.flags, "permanent"]))
                                      : item.flags.filter((f) => f !== "permanent");
                                    const next = [...inventory];
                                    next[idx] = { ...next[idx], flags: nextFlags };
                                    setInventory(next);
                                    markDirty();
                                  }}
                                />
                                <Lock size={11} color="#7dd3fc" /> Permanent
                              </label>
                              {worldId && selectedWorldArtifacts.length > 0 && (
                                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "0.75rem", cursor: "pointer" }}>
                                  <input
                                    type="checkbox"
                                    checked={isArt}
                                    onChange={(e) => {
                                      const checked = e.target.checked;
                                      const nextFlags = checked
                                        ? Array.from(new Set<ItemFlag>([...item.flags, "artifact"]))
                                        : item.flags.filter((f) => f !== "artifact");
                                      const next = [...inventory];
                                      next[idx] = {
                                        ...next[idx],
                                        flags: nextFlags,
                                        lore_id: checked
                                          ? item.lore_id || selectedWorldArtifacts[0].id
                                          : null,
                                      };
                                      setInventory(next);
                                      markDirty();
                                    }}
                                  />
                                  <Sparkles size={11} color="#d8b4fe" /> World Artifact
                                </label>
                              )}
                              {isArt && worldId && selectedWorldArtifacts.length > 0 && (
                                <select
                                  className="field-select"
                                  style={{ width: "auto", minWidth: 200, fontSize: "0.74rem" }}
                                  value={item.lore_id || ""}
                                  onChange={(e) => {
                                    const next = [...inventory];
                                    next[idx] = { ...next[idx], lore_id: e.target.value || null };
                                    setInventory(next);
                                    markDirty();
                                  }}
                                >
                                  {selectedWorldArtifacts.map((ln) => (
                                    <option key={ln.id} value={ln.id}>
                                      {ln.title}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Media Tab */}
          <div
            style={{
              display: activeTab === "media" ? "flex" : "none",
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

          {error && <div style={{ color: "#fda4af" }}>{error}</div>}
        </div>

        <div className="modal-footer">
          <div style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {viewingHistory
              ? `Viewing historical Version ${selectedVersion} (Read-Only). Use "Set as Active" at top to activate.`
              : isDirty
              ? "Unsaved edits ready. Saving increments character version."
              : "Click any field above to edit."}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              className="btn"
              disabled={exportingChar}
              onClick={handleExportCharacter}
              title="Export this character as a .zcc package"
              style={{ display: "flex", alignItems: "center", gap: 6 }}
            >
              <Upload size={14} color="var(--accent-cyan)" />
              {exportingChar ? "Exporting..." : "Export (.zcc)"}
            </button>
            <button type="button" className="btn" onClick={onClose}>
              {isDirty ? "Cancel" : "Close"}
            </button>
            {!viewingHistory && isDirty && (
              <button
                type="button"
                className="btn btn-amber"
                disabled={saving}
                onClick={handleSave}
              >
                <Check size={14} />
                {saving ? "Saving..." : "Save Changes"}
              </button>
            )}
          </div>
        </div>

        {/* Lightbox Modal Overlay */}
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
      </div>
    </div>
  );
};

// ============================================================================
// World Inspector & Inline Editor Modal
// ============================================================================

export function mapDraftToNodesAndEdges(
  draft: {
    locations: LocationNodeDraft[];
    edges: LocationEdgeDraft[];
  },
  worldId: string
): { locations: LocationNode[]; edges: LocationEdge[] } {
  const usedIds = new Set<string>();
  const keyToId = new Map<string, string>();
  const nameToId = new Map<string, string>();

  const firstStartIdx = draft.locations.findIndex(
    (loc) => loc.is_starting_location
  );
  const startIdx = firstStartIdx >= 0 ? firstStartIdx : 0;

  const locations: LocationNode[] = draft.locations.map((loc, idx) => {
    const rawKey = (loc.key || "").trim();
    let id = rawKey || `loc_${idx}`;
    while (usedIds.has(id)) {
      id = `${rawKey || "loc"}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
    }
    usedIds.add(id);
    if (rawKey && !keyToId.has(rawKey)) {
      keyToId.set(rawKey, id);
    }
    keyToId.set(id, id);
    if (loc.name) {
      nameToId.set(loc.name.trim().toLowerCase(), id);
    }

    const isStart = idx === startIdx;
    return {
      id,
      world_id: worldId,
      name: loc.name,
      summary: loc.summary,
      description: loc.description,
      environmental_tags: [...(loc.environmental_tags ?? [])],
      is_starting_location: isStart,
      is_hub: Boolean(loc.is_hub),
      starting_message: loc.starting_message ?? "",
      lore_nodes: (loc.lore_nodes ?? []).map((ln, lIdx) => ({
        id: ln.id || `draft_loc_lore_${idx}_${lIdx}`,
        world_id: worldId,
        location_id: id,
        title: ln.title,
        category: LOCATION_LORE_CATEGORIES.includes(
          ln.category as LocationLoreCategory
        )
          ? (ln.category as LocationLoreCategory)
          : "rumor",
        content: ln.content,
        entity_tags: [...(ln.entity_tags ?? [])],
      })),
    };
  });

  const resolveLocId = (keyOrName: string): string | undefined => {
    const trimmed = (keyOrName || "").trim();
    return keyToId.get(trimmed) ?? nameToId.get(trimmed.toLowerCase());
  };

  const occupiedFrom = new Map<string, Set<CompassDirection>>();
  const edges: LocationEdge[] = [];
  const hasDirectedPair = (fromId: string, toId: string) =>
    edges.some(
      (e) => e.from_location_id === fromId && e.to_location_id === toId
    );

  draft.edges.forEach((edge, idx) => {
    const fromId = resolveLocId(edge.from_key);
    const toId = resolveLocId(edge.to_key);
    if (!fromId || !toId || fromId === toId) return;

    let fromOcc = occupiedFrom.get(fromId);
    if (!fromOcc) {
      fromOcc = new Set<CompassDirection>();
      occupiedFrom.set(fromId, fromOcc);
    }
    const preferredDir = inferCompassDirection(
      edge.compass_direction,
      edge.direction_label
    );
    const fwdDir = pickCompassSlot(preferredDir, fromOcc);

    if (!hasDirectedPair(fromId, toId)) {
      fromOcc.add(fwdDir);
      edges.push({
        id: `edge_${idx}_fwd_${Math.random().toString(36).slice(2, 6)}`,
        world_id: worldId,
        from_location_id: fromId,
        to_location_id: toId,
        direction_label: edge.direction_label || "Passage",
        compass_direction: fwdDir,
        travel_minutes: edge.travel_minutes ?? 1,
        is_locked_or_hidden: Boolean(edge.is_locked_or_hidden),
      });
    }

    if (edge.bidirectional !== false && !hasDirectedPair(toId, fromId)) {
      let toOcc = occupiedFrom.get(toId);
      if (!toOcc) {
        toOcc = new Set<CompassDirection>();
        occupiedFrom.set(toId, toOcc);
      }
      const revDir = pickCompassSlot(OPPOSITE_COMPASS[fwdDir], toOcc);
      toOcc.add(revDir);
      const fromLocName =
        locations.find((l) => l.id === fromId)?.name ?? edge.from_key;
      edges.push({
        id: `edge_${idx}_rev_${Math.random().toString(36).slice(2, 6)}`,
        world_id: worldId,
        from_location_id: toId,
        to_location_id: fromId,
        direction_label:
          edge.reverse_direction_label || `Return to ${fromLocName}`,
        compass_direction: revDir,
        travel_minutes: edge.travel_minutes ?? 1,
        is_locked_or_hidden: Boolean(edge.is_locked_or_hidden),
      });
    }
  });

  return { locations, edges };
}

export function draftToWorldRecord(draft: WorldWizardDraft): WorldRecord {
  const draftWorldId = "draft_world";
  const { locations, edges } = mapDraftToNodesAndEdges(draft, draftWorldId);

  const lore_nodes: LoreNode[] = (draft.lore_nodes ?? []).map((lore, idx) => ({
    id: lore.id || `draft_lore_${idx}`,
    world_id: draftWorldId,
    title: lore.title,
    category: WORLD_LORE_CATEGORIES.includes(lore.category as WorldLoreCategory)
      ? (lore.category as WorldLoreCategory)
      : "faction",
    content: lore.content,
    entity_tags: [...(lore.entity_tags ?? [])],
  }));

  return {
    id: draftWorldId,
    name: draft.name,
    global_rules: { ...draft.global_rules },
    created_at: new Date().toISOString(),
    locations,
    edges,
    lore_nodes,
  };
}

export function worldStateToDraft(state: {
  name: string;
  global_rules: WorldGlobalRules;
  locations: LocationNode[];
  edges: LocationEdge[];
  lore_nodes: LoreNode[];
}): WorldWizardDraft {
  const validCategories = new Set<string>(WORLD_LORE_CATEGORIES);
  const hasStart = state.locations.some((l) => l.is_starting_location);
  return {
    name: state.name.trim() || "Untitled World",
    global_rules: state.global_rules,
    locations: state.locations.map((loc, idx) => ({
      key: loc.id || `loc_${idx}`,
      name: loc.name.trim() || `Location ${idx + 1}`,
      summary: loc.summary.trim() || loc.name.trim() || `Location ${idx + 1}`,
      description:
        loc.description.trim() || loc.summary.trim() || loc.name.trim(),
      environmental_tags: loc.environmental_tags,
      is_starting_location: hasStart
        ? Boolean(loc.is_starting_location)
        : idx === 0,
      is_hub: Boolean(loc.is_hub),
      starting_message: loc.starting_message ?? "",
      lore_nodes: (loc.lore_nodes ?? []).map((ln) => ({
        id: ln.id,
        title: ln.title.trim(),
        category: LOCATION_LORE_CATEGORIES.includes(
          ln.category as LocationLoreCategory
        )
          ? (ln.category as LocationLoreCategory)
          : "rumor",
        content: ln.content.trim(),
        entity_tags: ln.entity_tags,
      })),
    })),
    edges: state.edges.map((edge) => ({
      from_key: edge.from_location_id,
      to_key: edge.to_location_id,
      direction_label: edge.direction_label,
      reverse_direction_label: "",
      compass_direction: edge.compass_direction ?? null,
      travel_minutes: edge.travel_minutes,
      is_locked_or_hidden: Boolean(edge.is_locked_or_hidden),
      bidirectional: false,
    })),
    lore_nodes: state.lore_nodes.map((lore) => ({
      id: lore.id,
      title: lore.title.trim() || "Untitled Lore",
      category: (validCategories.has(lore.category)
        ? lore.category
        : "faction") as WorldLoreCategory,
      content: lore.content.trim(),
      entity_tags: lore.entity_tags,
    })),
  };
}

interface WorldInspectorModalProps {
  world: WorldRecord;
  onClose: () => void;
  onSaved: (updated: WorldRecord) => void;
  mode?: "inspector" | "wizard";
  onBackToSeed?: () => void;
  onCommitDraft?: (payload: {
    name: string;
    global_rules: WorldGlobalRules;
    locations: LocationNode[];
    edges: LocationEdge[];
    lore_nodes: LoreNode[];
  }) => Promise<WorldRecord>;
}

type WorldTab = "base" | "map" | "lore";

export const WorldInspectorModal: React.FC<WorldInspectorModalProps> = ({
  world,
  onClose,
  onSaved,
  mode = "inspector",
  onBackToSeed,
  onCommitDraft,
}) => {
  const [activeTab, setActiveTab] = useState<WorldTab>("base");
  const [name, setName] = useState(world.name);
  const [globalRules, setGlobalRules] = useState({ ...world.global_rules });
  const [locations, setLocations] = useState<LocationNode[]>(
    world.locations
      .filter((loc) => !loc.created_at_turn_id)
      .map((loc) => ({
        ...loc,
        environmental_tags: [...loc.environmental_tags],
        lore_nodes: (loc.lore_nodes ?? []).map((ln) => ({
          ...ln,
          entity_tags: [...(ln.entity_tags ?? [])],
        })),
      }))
  );
  const [edges, setEdges] = useState<LocationEdge[]>(
    world.edges
      .filter((edge) => !edge.created_at_turn_id)
      .map((edge) => ({ ...edge }))
  );
  const [loreNodes, setLoreNodes] = useState<LoreNode[]>(
    world.lore_nodes.map((lore) => ({
      ...lore,
      category: WORLD_LORE_CATEGORIES.includes(
        lore.category as WorldLoreCategory
      )
        ? (lore.category as WorldLoreCategory)
        : "faction",
      entity_tags: [...lore.entity_tags],
    }))
  );
  const [pendingWorldLoreTagDrafts, setPendingWorldLoreTagDrafts] = useState<
    Record<string, string>
  >({});

  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exportingWorld, setExportingWorld] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleExportWorld = async () => {
    setExportingWorld(true);
    try {
      const includeChars = window.confirm("Include resident characters belonging to this world in the export package?");
      await api.exportWorld(world.id, includeChars);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setExportingWorld(false);
    }
  };

  // Re-imagine Map Modal state
  const [showReimagineModal, setShowReimagineModal] = useState(false);
  const [reimagineDescription, setReimagineDescription] = useState("");
  const [reimagineCount, setReimagineCount] = useState(
    Math.max(3, Math.min(8, locations.length || 4))
  );
  const [reimagining, setReimagining] = useState(false);
  const [reimagineError, setReimagineError] = useState<string | null>(null);

  const handleExecuteReimagine = async () => {
    if (!reimagineDescription.trim()) return;
    setReimagining(true);
    setReimagineError(null);
    try {
      const mapDraft = await api.reimagineWorldMap({
        world_name: name,
        global_rules: globalRules,
        map_description: reimagineDescription.trim(),
        location_count: reimagineCount,
      });
      const { locations: newLocs, edges: newEdges } = mapDraftToNodesAndEdges(
        mapDraft,
        world.id
      );
      setLocations(newLocs);
      setEdges(newEdges);
      markDirty();
      setShowReimagineModal(false);
      setReimagineDescription("");
    } catch (err) {
      setReimagineError(String(err));
    } finally {
      setReimagining(false);
    }
  };

  const markDirty = () => {
    if (!isDirty) setIsDirty(true);
  };

  const handleSetStartingLocation = (targetLocId: string) => {
    setLocations((prev) =>
      prev.map((loc) => ({
        ...loc,
        is_starting_location: loc.id === targetLocId,
      }))
    );
    markDirty();
  };

  const handleUpdateLocation = (updated: LocationNode) => {
    setLocations((prev) =>
      prev.map((loc) => (loc.id === updated.id ? updated : loc))
    );
    markDirty();
  };

  const handleDeleteLocation = (targetLocId: string) => {
    if (locations.length <= 1) return;
    const remaining = locations.filter((l) => l.id !== targetLocId);
    const wasStarting = locations.find((l) => l.id === targetLocId)?.is_starting_location;
    if (wasStarting && remaining.length > 0) {
      remaining[0] = { ...remaining[0], is_starting_location: true };
    }
    setLocations(remaining);
    setEdges((prev) =>
      prev.filter(
        (e) =>
          e.from_location_id !== targetLocId && e.to_location_id !== targetLocId
      )
    );
    markDirty();
  };

  const handleDeleteEdge = (edgeId: string) => {
    const target = edges.find((e) => e.id === edgeId);
    if (!target) return;
    const startId =
      locations.find((l) => l.is_starting_location)?.id ?? locations[0]?.id;
    if (!startId) return;

    const remaining = edges.filter(
      (e) =>
        e.id !== edgeId &&
        !(
          e.from_location_id === target.to_location_id &&
          e.to_location_id === target.from_location_id
        )
    );

    const adj = new Map<string, Set<string>>();
    for (const e of remaining) {
      if (!adj.has(e.from_location_id)) adj.set(e.from_location_id, new Set());
      if (!adj.has(e.to_location_id)) adj.set(e.to_location_id, new Set());
      adj.get(e.from_location_id)!.add(e.to_location_id);
      adj.get(e.to_location_id)!.add(e.from_location_id);
    }

    const reachable = new Set<string>([startId]);
    const queue = [startId];
    while (queue.length > 0) {
      const curr = queue.shift()!;
      for (const nextId of adj.get(curr) ?? []) {
        if (!reachable.has(nextId)) {
          reachable.add(nextId);
          queue.push(nextId);
        }
      }
    }

    if (
      !reachable.has(target.from_location_id) ||
      !reachable.has(target.to_location_id)
    ) {
      return;
    }

    setEdges(remaining);
    markDirty();
  };

  const handleUpdateEdgeDistance = (payload: {
    edgeId: string;
    travel_minutes: number;
  }) => {
    const target = edges.find((e) => e.id === payload.edgeId);
    if (!target) return;
    setEdges((prev) =>
      prev.map((e) => {
        if (e.id === payload.edgeId) {
          return { ...e, travel_minutes: payload.travel_minutes };
        }
        if (
          e.from_location_id === target.to_location_id &&
          e.to_location_id === target.from_location_id
        ) {
          return { ...e, travel_minutes: payload.travel_minutes };
        }
        return e;
      })
    );
    markDirty();
  };

  const handleAddEdge = (payload: {
    from_location_id: string;
    to_location_id: string;
    direction_label?: string;
    compass_direction: CompassDirection;
    travel_minutes: number;
    bidirectional?: boolean;
  }) => {
    const newEdgeId = `edge_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newEdge: LocationEdge = {
      id: newEdgeId,
      world_id: world.id,
      from_location_id: payload.from_location_id,
      to_location_id: payload.to_location_id,
      direction_label: payload.direction_label || "Passage",
      compass_direction: payload.compass_direction,
      travel_minutes: payload.travel_minutes,
      is_locked_or_hidden: false,
    };
    const nextEdges = [...edges, newEdge];
    if (payload.bidirectional) {
      const returnEdgeId = `edge_${Date.now()}_rev_${Math.random().toString(36).slice(2, 6)}`;
      nextEdges.push({
        id: returnEdgeId,
        world_id: world.id,
        from_location_id: payload.to_location_id,
        to_location_id: payload.from_location_id,
        direction_label: `Return passage`,
        compass_direction: OPPOSITE_COMPASS[payload.compass_direction],
        travel_minutes: payload.travel_minutes,
        is_locked_or_hidden: false,
      });
    }
    setEdges(nextEdges);
    markDirty();
  };

  const handleCreateLinkedLocation = async (payload: {
    from_location_id: string;
    name: string;
    compass_direction: CompassDirection;
    travel_minutes: number;
    description: string;
    environmental_tags: string[];
    is_hub?: boolean;
    summary?: string;
  }): Promise<string> => {
    const newLocId = `new_loc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const fromLoc = locations.find((l) => l.id === payload.from_location_id);
    const newLoc: LocationNode = {
      id: newLocId,
      world_id: world.id,
      name: payload.name,
      summary: payload.summary || payload.name,
      description: payload.description,
      environmental_tags: payload.environmental_tags,
      is_starting_location: false,
      is_hub: Boolean(payload.is_hub),
    };
    const fwdEdgeId = `new_edge_${Date.now()}_fwd`;
    const revEdgeId = `new_edge_${Date.now()}_rev`;
    const fwdEdge: LocationEdge = {
      id: fwdEdgeId,
      world_id: world.id,
      from_location_id: payload.from_location_id,
      to_location_id: newLocId,
      direction_label: `Passage to ${payload.name}`,
      compass_direction: payload.compass_direction,
      travel_minutes: payload.travel_minutes,
      is_locked_or_hidden: false,
    };
    const revEdge: LocationEdge = {
      id: revEdgeId,
      world_id: world.id,
      from_location_id: newLocId,
      to_location_id: payload.from_location_id,
      direction_label: `Back to ${fromLoc?.name ?? "adjoining room"}`,
      compass_direction: OPPOSITE_COMPASS[payload.compass_direction],
      travel_minutes: payload.travel_minutes,
      is_locked_or_hidden: false,
    };
    setLocations((prev) => [...prev, newLoc]);
    setEdges((prev) => [...prev, fwdEdge, revEdge]);
    markDirty();
    return newLocId;
  };

  const invalidWorldLoreCount = loreNodes.filter((lore) => {
    const pendingRaw = pendingWorldLoreTagDrafts[lore.id] || "";
    const pendingParts = pendingRaw
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const effectiveTags = normalizeTagList(lore.entity_tags || [], pendingParts);
    return (
      !lore.title.trim() ||
      !lore.content.trim() ||
      !WORLD_LORE_CATEGORIES.includes(lore.category as WorldLoreCategory) ||
      effectiveTags.length === 0
    );
  }).length;

  const invalidLocationLoreCount = locations.reduce((acc, loc) => {
    const locInvalid = (loc.lore_nodes ?? []).filter(
      (ln) =>
        !ln.title.trim() ||
        !ln.content.trim() ||
        !LOCATION_LORE_CATEGORIES.includes(
          ln.category as LocationLoreCategory
        ) ||
        !ln.entity_tags ||
        ln.entity_tags.length === 0
    ).length;
    return acc + locInvalid;
  }, 0);

  const locationsWithLoreCount = locations.reduce(
    (acc, loc) => acc + (loc.lore_nodes?.length ?? 0),
    0
  );

  const handleSave = async () => {
    if (locations.length === 0) {
      setError("At least one location is required.");
      return;
    }

    const flushedWorldLore: LoreNode[] = loreNodes.map((lore) => {
      const pendingRaw = pendingWorldLoreTagDrafts[lore.id] || "";
      const pendingParts = pendingRaw
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const effectiveTags = normalizeTagList(
        lore.entity_tags || [],
        pendingParts
      );
      return {
        ...lore,
        title: lore.title.trim(),
        content: lore.content.trim(),
        category: WORLD_LORE_CATEGORIES.includes(
          lore.category as WorldLoreCategory
        )
          ? (lore.category as WorldLoreCategory)
          : "faction",
        entity_tags: effectiveTags,
      };
    });

    for (let i = 0; i < flushedWorldLore.length; i++) {
      const item = flushedWorldLore[i];
      if (!item.title || !item.content || item.entity_tags.length === 0) {
        setActiveTab("lore");
        setError(
          `World Lore entry #${i + 1} ("${
            item.title || "Untitled"
          }") must have a non-empty title, content, and at least 1 trigger keyword.`
        );
        return;
      }
    }

    const sanitizedLocations: LocationNode[] = locations.map((loc) => ({
      ...loc,
      lore_nodes: (loc.lore_nodes ?? []).map((ln) => ({
        ...ln,
        title: ln.title.trim(),
        content: ln.content.trim(),
        category: LOCATION_LORE_CATEGORIES.includes(
          ln.category as LocationLoreCategory
        )
          ? (ln.category as LocationLoreCategory)
          : "rumor",
        entity_tags: normalizeTagList(ln.entity_tags || [], []),
      })),
    }));

    for (const loc of sanitizedLocations) {
      for (let i = 0; i < (loc.lore_nodes ?? []).length; i++) {
        const ln = loc.lore_nodes![i];
        if (!ln.title || !ln.content || ln.entity_tags.length === 0) {
          setActiveTab("map");
          setError(
            `Location "${loc.name}" Lore entry #${i + 1} ("${
              ln.title || "Untitled"
            }") must have a non-empty title, content, and at least 1 trigger keyword.`
          );
          return;
        }
      }
    }

    setLoreNodes(flushedWorldLore);
    setLocations(sanitizedLocations);
    setPendingWorldLoreTagDrafts({});

    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim() || world.name,
      global_rules: globalRules,
      locations: sanitizedLocations,
      edges,
      lore_nodes: flushedWorldLore,
    };
    try {
      const updated =
        mode === "wizard" && onCommitDraft
          ? await onCommitDraft(payload)
          : await api.updateWorld(world.id, payload);
      onSaved(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={mode === "wizard" ? undefined : onClose}
    >
      <div
        className="modal-panel"
        style={{
          width: activeTab === "map" ? "min(1120px, 96vw)" : "min(860px, 95vw)",
          transition: "width 0.2s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Globe size={18} color="var(--accent-cyan)" />
            World Sheet
            {mode === "wizard" && (
              <span
                style={{
                  fontSize: "0.72rem",
                  color: "var(--accent-cyan)",
                  background: "rgba(34, 211, 238, 0.1)",
                  border: "1px solid rgba(34, 211, 238, 0.3)",
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontWeight: 500,
                }}
              >
                1.2 Wizard Draft
              </span>
            )}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="modal-tabs modal-tabs-cyan" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "base"}
            className={`modal-tab-btn ${activeTab === "base" ? "active" : ""}`}
            onClick={() => setActiveTab("base")}
          >
            <Globe size={14} />
            <span>Base</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "map"}
            className={`modal-tab-btn ${activeTab === "map" ? "active" : ""}`}
            onClick={() => setActiveTab("map")}
          >
            <Compass size={14} />
            <span>Map</span>
            <span className="modal-tab-badge">{locations.length}</span>
            {invalidLocationLoreCount > 0 && (
              <span
                className="modal-tab-badge"
                style={{
                  background: "rgba(244, 63, 94, 0.22)",
                  color: "#fda4af",
                  border: "1px solid rgba(244, 63, 94, 0.5)",
                }}
                title={`${invalidLocationLoreCount} incomplete location lore entry/entries`}
              >
                !{invalidLocationLoreCount}
              </span>
            )}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "lore"}
            className={`modal-tab-btn ${activeTab === "lore" ? "active" : ""}`}
            onClick={() => setActiveTab("lore")}
          >
            <BookOpen size={14} />
            <span>Lore</span>
            <span className="modal-tab-badge">{loreNodes.length}</span>
            {invalidWorldLoreCount > 0 && (
              <span
                className="modal-tab-badge"
                style={{
                  background: "rgba(244, 63, 94, 0.22)",
                  color: "#fda4af",
                  border: "1px solid rgba(244, 63, 94, 0.5)",
                }}
                title={`${invalidWorldLoreCount} incomplete world lore entry/entries`}
              >
                !{invalidWorldLoreCount}
              </span>
            )}
          </button>
        </div>

        <div className="modal-body">
          {/* Base Tab */}
          <div
            style={{
              display: activeTab === "base" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <div
              style={{
                fontSize: "0.76rem",
                color: "var(--text-secondary)",
                background: "var(--bg-card)",
                padding: "8px 12px",
                borderRadius: 6,
                border: "1px solid var(--border-subtle)",
              }}
            >
              {mode === "wizard"
                ? "Click on any field below to edit it, or switch to the Map and Lore tabs above to customize locations, passages, and GraphRAG lore before committing your world."
                : "Click on any field below to edit it. Active campaigns running in this world remain pinned to their original world snapshot automatically."}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 12,
              }}
            >
              <ClickToEditField
                label="World Name"
                value={name}
                onChange={(val) => {
                  setName(val);
                  markDirty();
                }}
              />
              <ClickToEditField
                label="Genre"
                value={globalRules.genre}
                onChange={(val) => {
                  setGlobalRules({ ...globalRules, genre: val });
                  markDirty();
                }}
              />
              <ClickToEditField
                label="Starting Clock (YYYY-MM-DD HH:MM)"
                value={globalRules.starting_timestamp}
                onChange={(val) => {
                  setGlobalRules({ ...globalRules, starting_timestamp: val });
                  markDirty();
                }}
              />
            </div>

            <ClickToEditField
              label="Narrative Tone & Stylistic Atmosphere"
              value={globalRules.tone}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, tone: val });
                markDirty();
              }}
            />

            <ClickToEditField
              label="Setting Overview (Zone 1 Static Prefix)"
              value={globalRules.setting_overview}
              multiline
              rows={3}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, setting_overview: val });
                markDirty();
              }}
            />

            <ClickToEditField
              label="Technology / Magic / World Consistency Rules"
              value={globalRules.tech_or_magic_rules}
              multiline
              rows={2}
              onChange={(val) => {
                setGlobalRules({ ...globalRules, tech_or_magic_rules: val });
                markDirty();
              }}
            />
          </div>

          {/* Map Tab */}
          <div
            style={{
              display: activeTab === "map" ? "flex" : "none",
              flexDirection: "column",
              gap: 10,
              minHeight: 520,
              height: "calc(88vh - 220px)",
            }}
          >
            {locations.length === 0 ? (
              <div
                style={{
                  padding: 30,
                  textAlign: "center",
                  background: "var(--bg-deep)",
                  borderRadius: 8,
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ color: "var(--text-muted)", marginBottom: 12 }}>
                  No spatial locations defined. Add an initial starting hub or generate a map with AI.
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-amber"
                    onClick={() => {
                      const newId = `new_loc_${Date.now()}`;
                      setLocations([
                        {
                          id: newId,
                          world_id: world.id,
                          name: "Main Plaza / Starting Hub",
                          summary: "Central arrival threshold and starting hub.",
                          description:
                            "The primary gathering hub and central gateway connecting adjoining sectors.",
                          environmental_tags: ["hub", "central", "open"],
                          is_starting_location: true,
                          is_hub: false,
                        },
                      ]);
                      markDirty();
                    }}
                  >
                    <Plus size={14} /> Create Starting Hub
                  </button>
                  <button
                    type="button"
                    className="btn btn-purple"
                    onClick={() => setShowReimagineModal(true)}
                  >
                    <Sparkles size={14} /> Re-imagine Map with AI
                  </button>
                </div>
              </div>
            ) : (
              <SpatialTopologyView
                title={`${name} — Spatial Topology (${locations.length} Locations, ${edges.length} Passages)`}
                locations={locations}
                edges={edges}
                activeLocationId={
                  locations.find((l) => l.is_starting_location)?.id ??
                  locations[0]?.id ??
                  ""
                }
                mode="editor"
                onReimagineMap={() => setShowReimagineModal(true)}
                onUpdateLocation={handleUpdateLocation}
                onDeleteLocation={handleDeleteLocation}
                onSetStartingLocation={handleSetStartingLocation}
                onAddEdge={handleAddEdge}
                onDeleteEdge={handleDeleteEdge}
                onUpdateEdgeDistance={handleUpdateEdgeDistance}
                onCreateLinkedLocation={handleCreateLinkedLocation}
              />
            )}
          </div>

          {/* Lore Tab */}
          <div
            style={{
              display: activeTab === "lore" ? "flex" : "none",
              flexDirection: "column",
              gap: 14,
            }}
          >
            {/* World Lore Nodes */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  className="sidebar-label"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <BookOpen size={13} color="var(--accent-violet)" />
                  World Macro Lore — Factions, History, Culture &amp; Rumors ({loreNodes.length})
                </span>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: "3px 8px", fontSize: "0.72rem" }}
                  onClick={() => {
                    setLoreNodes([
                      ...loreNodes,
                      {
                        id: `new_lore_${Date.now()}`,
                        world_id: world.id,
                        title: "New Lore Entry",
                        category: "faction",
                        content:
                          "Describe a macro faction, historical event, cultural norm, or world rumor...",
                        entity_tags: [],
                      },
                    ]);
                    markDirty();
                  }}
                >
                  <Plus size={12} /> Add Lore Node
                </button>
              </div>

              {loreNodes.length === 0 ? (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--text-muted)",
                    fontStyle: "italic",
                  }}
                >
                  No world lore nodes indexed. Add macro lore for factions, history, culture, and rumors (attach room-specific lore &amp; secrets on the Map tab).
                </div>
              ) : (
                loreNodes.map((lore, idx) => {
                  const pendingRaw = pendingWorldLoreTagDrafts[lore.id] || "";
                  const hasTags =
                    lore.entity_tags.length > 0 || Boolean(pendingRaw.trim());
                  const isEntryInvalid =
                    !lore.title.trim() || !lore.content.trim() || !hasTags;

                  return (
                    <div
                      key={lore.id}
                      style={{
                        background: "var(--bg-panel)",
                        border: isEntryInvalid
                          ? "1px solid rgba(244, 63, 94, 0.55)"
                          : "1px solid var(--border-subtle)",
                        borderRadius: 6,
                        padding: 10,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1.1fr 130px 1.4fr auto",
                          gap: 8,
                          alignItems: "start",
                        }}
                      >
                        <ClickToEditField
                          label="Lore Title"
                          value={lore.title}
                          onChange={(val) => {
                            const next = [...loreNodes];
                            next[idx] = { ...next[idx], title: val };
                            setLoreNodes(next);
                            markDirty();
                          }}
                        />
                        <div className="field-group">
                          <label>Category</label>
                          <select
                            className="field-select"
                            value={lore.category}
                            onChange={(e) => {
                              const next = [...loreNodes];
                              next[idx] = {
                                ...next[idx],
                                category: e.target.value as WorldLoreCategory,
                              };
                              setLoreNodes(next);
                              markDirty();
                            }}
                          >
                            {WORLD_LORE_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field-group">
                          <label>Trigger Keywords (min 1)</label>
                          <TagChipsInput
                            value={lore.entity_tags}
                            accentVariant="violet"
                            placeholder="Add keyword & press Enter..."
                            onDraftChange={(draftStr) => {
                              setPendingWorldLoreTagDrafts((prev) => ({
                                ...prev,
                                [lore.id]: draftStr,
                              }));
                            }}
                            onChange={(nextTags) => {
                              const next = [...loreNodes];
                              next[idx] = {
                                ...next[idx],
                                entity_tags: nextTags,
                              };
                              setLoreNodes(next);
                              markDirty();
                            }}
                          />
                        </div>
                        <button
                          type="button"
                          className="item-remove-btn"
                          style={{ marginTop: 22 }}
                          onClick={() => {
                            setLoreNodes(loreNodes.filter((_, i) => i !== idx));
                            setPendingWorldLoreTagDrafts((prev) => {
                              const copy = { ...prev };
                              delete copy[lore.id];
                              return copy;
                            });
                            markDirty();
                          }}
                          title="Remove lore node"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <ClickToEditField
                        label="Lore Content"
                        value={lore.content}
                        multiline
                        rows={2}
                        onChange={(val) => {
                          const next = [...loreNodes];
                          next[idx] = { ...next[idx], content: val };
                          setLoreNodes(next);
                          markDirty();
                        }}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {error && (
            <div
              style={{
                color: "#fda4af",
                background: "rgba(244, 63, 94, 0.1)",
                border: "1px solid rgba(244, 63, 94, 0.35)",
                borderRadius: 6,
                padding: "8px 12px",
                fontSize: "0.78rem",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <AlertCircle size={15} />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {mode === "wizard" ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {onBackToSeed && (
                  <button
                    type="button"
                    className="btn"
                    disabled={saving}
                    onClick={onBackToSeed}
                  >
                    ← Back to Seed
                  </button>
                )}
                <span
                  style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}
                >
                  {isDirty
                    ? "Draft customized. Ready to commit world & spatial graph."
                    : "Click any field above or switch tabs to customize before committing."}
                </span>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={saving}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-cyan"
                  disabled={saving || locations.length === 0}
                  onClick={handleSave}
                >
                  <Check size={15} />
                  {saving ? "Saving..." : "Commit World & Spatial Graph"}
                </button>
              </div>
            </>
          ) : (
            <>
              <div
                style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}
              >
                {isDirty
                  ? "Unsaved edits ready. Saving preserves existing campaigns via silent versioning."
                  : "Click any field above to edit."}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={exportingWorld}
                  onClick={handleExportWorld}
                  title="Export this world as a .zcc package"
                  style={{ display: "flex", alignItems: "center", gap: 6 }}
                >
                  <Upload size={14} color="var(--accent-cyan)" />
                  {exportingWorld ? "Exporting..." : "Export (.zcc)"}
                </button>
                <button type="button" className="btn" onClick={onClose}>
                  {isDirty ? "Cancel" : "Close"}
                </button>
                {isDirty && (
                  <button
                    type="button"
                    className="btn btn-amber"
                    disabled={saving}
                    onClick={handleSave}
                  >
                    <Check size={14} />
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Re-imagine Spatial Map Modal */}
      {showReimagineModal && (
        <div
          className="modal-backdrop"
          style={{ zIndex: 1200 }}
          onClick={() => !reimagining && setShowReimagineModal(false)}
        >
          <div
            className="modal-panel"
            style={{ width: "min(620px, 95vw)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  color: "var(--accent-purple, #c084fc)",
                }}
              >
                <Sparkles size={18} />
                Re-imagine Spatial Map with AI
              </span>
              <button
                type="button"
                className="btn"
                disabled={reimagining}
                onClick={() => setShowReimagineModal(false)}
              >
                <X size={15} />
              </button>
            </div>

            <div
              className="modal-body"
              style={{ display: "flex", flexDirection: "column", gap: 14 }}
            >
              <div
                style={{
                  fontSize: "0.78rem",
                  color: "var(--text-secondary)",
                  background: "var(--bg-card)",
                  padding: "10px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--border-subtle)",
                  lineHeight: 1.5,
                }}
              >
                Describe your desired layout, rooms, or spatial atmosphere for{" "}
                <strong>{name}</strong> ({globalRules.genre}). The AI will
                regenerate the interconnected locations and passages to match your
                vision while preserving existing world rules and lore.
              </div>

              {reimagineError && (
                <div
                  style={{
                    color: "var(--accent-rose)",
                    fontSize: "0.82rem",
                    background: "rgba(244, 63, 94, 0.1)",
                    padding: "8px 12px",
                    borderRadius: 6,
                  }}
                >
                  {reimagineError}
                </div>
              )}

              <div className="field-group">
                <label>Desired Map Vision & Spatial Layout</label>
                <textarea
                  className="field-textarea"
                  rows={4}
                  placeholder="e.g. A multi-level subterranean bunker: a fortified decontamination airlock at the surface, branching down via service elevator to an overgrown hydroponics lab, a humming power core, and a flooded sub-level tunnel..."
                  value={reimagineDescription}
                  onChange={(e) => setReimagineDescription(e.target.value)}
                  disabled={reimagining}
                  autoFocus
                />
              </div>

              <div className="field-group">
                <label>Target Location Count (3–8)</label>
                <input
                  type="number"
                  className="field-input"
                  min={3}
                  max={8}
                  value={reimagineCount}
                  onChange={(e) =>
                    setReimagineCount(
                      Math.max(3, Math.min(8, parseInt(e.target.value, 10) || 4))
                    )
                  }
                  disabled={reimagining}
                />
              </div>

              <div style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                Note: Regenerating the map replaces current draft locations and
                passages with the newly synthesized spatial topology. World
                rules, overview, and world-level lore entries remain intact.
              </div>

              {locationsWithLoreCount > 0 && (
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#fde68a",
                    background: "rgba(245, 158, 11, 0.12)",
                    border: "1px solid rgba(245, 158, 11, 0.4)",
                    borderRadius: 6,
                    padding: "8px 12px",
                  }}
                >
                  <strong>Warning:</strong> Replacing the map will discard{" "}
                  <strong>{locationsWithLoreCount}</strong> location-attached lore
                  entry/entries on your current rooms.
                </div>
              )}
            </div>

            <div
              className="modal-footer"
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 8,
                padding: "12px 16px",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <button
                type="button"
                className="btn"
                disabled={reimagining}
                onClick={() => setShowReimagineModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-purple"
                disabled={reimagining || !reimagineDescription.trim()}
                onClick={handleExecuteReimagine}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <Sparkles size={14} />
                {reimagining ? "Re-imagining Map..." : "Regenerate Map"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
