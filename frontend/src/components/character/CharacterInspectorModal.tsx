import React, { useEffect, useState } from "react";
import {
  Brain,
  Check,
  Database,
  Eye,
  History,
  Image as ImageIcon,
  Loader2,
  MessageSquare,
  Package,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { api } from "../../api";
import {
  CharacterBaseTab,
  CharacterAppearanceTab,
  CharacterPersonalityTab,
  CharacterVoiceTab,
  CharacterBaseData,
  CharacterAppearanceData,
  CharacterPersonalityData,
  CharacterVoiceData,
} from ".";
import type {
  CharacterRecord,
  CharacterVersionSummary,
  GalleryImage,
  ItemFlag,
  ItemInstance,
  MemoryShard,
  VoiceAnchor,
  WorldRecord,
} from "../../types";
import { hasItemFlag, normalizeItemList } from "../../types";
import { CharacterMemoriesTab } from "./CharacterMemoriesTab";
import { CharacterInventoryTab } from "./CharacterInventoryTab";
import { CharacterMediaTab } from "./CharacterMediaTab";
import { BASIC_EMOTIONS, cropToSquareBlob } from "./characterMediaUtils";

export { BASIC_EMOTIONS, cropToSquareBlob };

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

  const [portraits, setPortraits] = useState<Record<string, string>>(
    character.portraits ?? {}
  );
  const [gallery, setGallery] = useState<GalleryImage[]>(
    character.gallery ?? []
  );
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
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

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

          <CharacterMemoriesTab
            isActive={activeTab === "memories"}
            memoryShards={memoryShards}
            viewingHistory={viewingHistory}
            markDirty={markDirty}
            setMemoryShards={setMemoryShards}
          />

          <CharacterInventoryTab
            isActive={activeTab === "inventory"}
            equipped={equipped}
            setEquipped={setEquipped}
            inventory={inventory}
            setInventory={setInventory}
            worldId={worldId}
            selectedWorldArtifacts={selectedWorldArtifacts}
            selectedWorldArtifactTitleMap={selectedWorldArtifactTitleMap}
            viewingHistory={viewingHistory}
            markDirty={markDirty}
          />

          <CharacterMediaTab
            isActive={activeTab === "media"}
            characterId={characterId}
            latestCharacter={latestCharacter}
            setLatestCharacter={setLatestCharacter}
            setCharacterId={setCharacterId}
            portraits={portraits}
            gallery={gallery}
            setPortraits={setPortraits}
            setGallery={setGallery}
            viewingHistory={viewingHistory}
            onSaved={onSaved}
          />

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

      </div>
    </div>
  );
};
