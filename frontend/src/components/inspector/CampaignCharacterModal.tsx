import React, { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Brain,
  Database,
  Eye,
  Image as ImageIcon,
  MapPin,
  MessageSquare,
  Package,
  User,
  Users,
  X,
} from "lucide-react";
import {
  CharacterRecord,
  CharacterStateSnapshot,
  ItemEquipActionPayload,
  MemoryShard,
  WorldRecord,
  getTemperamentPresetMeta,
  splitLegacyWornItems,
} from "../../types";
import { getCharacterEmotionPortrait } from "../../utils/entityImages";
import {
  CharacterBaseTab,
  CharacterAppearanceTab,
  CharacterPersonalityTab,
  CharacterVoiceTab,
} from "../character";
import { CampaignCharacterMemoriesTab } from "./campaignCharacter/CampaignCharacterMemoriesTab";
import { CampaignCharacterInventoryTab } from "./campaignCharacter/CampaignCharacterInventoryTab";
import { CampaignCharacterStateTab } from "./campaignCharacter/CampaignCharacterStateTab";
import { CampaignCharacterMediaTab } from "./campaignCharacter/CampaignCharacterMediaTab";

type CampaignTab =
  | "base"
  | "appearance"
  | "personality"
  | "voice"
  | "memories"
  | "inventory"
  | "current"
  | "media";

interface CampaignCharacterModalProps {
  character: CharacterRecord;
  state: CharacterStateSnapshot;
  isPresent: boolean;
  elsewhereLocationName?: string;
  campaignId: string;
  campaignWorld?: WorldRecord;
  worlds?: WorldRecord[];
  initialTab?: CampaignTab;
  initialExpandedItemId?: string | null;
  isMutatingLocked?: boolean;
  characterNameMap?: Record<string, string>;
  onClose: () => void;
  onItemAction: (payload: ItemEquipActionPayload) => Promise<void> | void;
  onSaveMemories: (characterId: string, shards: MemoryShard[]) => Promise<void>;
}

export const CampaignCharacterModal: React.FC<CampaignCharacterModalProps> = ({
  character,
  state,
  isPresent,
  elsewhereLocationName,
  campaignId: _campaignId,
  campaignWorld,
  worlds = [],
  initialTab = "current",
  initialExpandedItemId = null,
  isMutatingLocked = false,
  characterNameMap = {},
  onClose,
  onItemAction,
  onSaveMemories,
}) => {
  const [activeTab, setActiveTab] = useState<CampaignTab>(
    initialExpandedItemId ? "inventory" : initialTab
  );
  const [memoryCount, setMemoryCount] = useState<number>(character.memory_shards.length);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const { equippedList, inventoryList } = useMemo(
    () => splitLegacyWornItems(state.equipped, state.inventory),
    [state.equipped, state.inventory]
  );

  const care = state.care_state ?? null;
  const activeEmotion = care?.active_emotion ?? "default";
  const livePortraitUrl = getCharacterEmotionPortrait(character, activeEmotion);
  const temperamentMeta = getTemperamentPresetMeta(
    character.baseline_psyche.temperament?.archetype
  );

  const homeWorld = worlds.find((w) => w.id === character.world_id);
  const activeWorld = campaignWorld ?? homeWorld;

  const worldArtifactNodes = useMemo(
    () =>
      (activeWorld?.lore_nodes ?? []).filter(
        (ln) => ln.category === "artifact" && !ln.location_id
      ),
    [activeWorld]
  );

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 85 }}>
      <div
        className="modal-panel"
        style={{ width: "min(860px, 95vw)", maxHeight: "92vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header">
          <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {livePortraitUrl ? (
              <img
                src={livePortraitUrl}
                alt={`${character.name} (${activeEmotion})`}
                title={`Expression: ${activeEmotion}`}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  objectFit: "cover",
                  border: "1px solid var(--border-subtle)",
                }}
              />
            ) : (
              <Users size={18} color="var(--accent-amber)" />
            )}
            <span style={{ fontWeight: 700 }}>{character.name}</span>
            <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
              · Character Dossier
            </span>
            <span
              className="badge"
              style={{ fontSize: "0.68rem", padding: "2px 6px" }}
              title={temperamentMeta.summary}
            >
              {temperamentMeta.label}
            </span>
            {!isPresent && (
              <span
                className="badge"
                style={{
                  fontSize: "0.7rem",
                  padding: "2px 6px",
                  background: "rgba(168, 85, 247, 0.15)",
                  borderColor: "rgba(168, 85, 247, 0.4)",
                  color: "#c084fc",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                <MapPin size={10} />
                Elsewhere{elsewhereLocationName ? `: ${elsewhereLocationName}` : ""}
              </span>
            )}
          </span>
          <button type="button" className="btn" onClick={onClose} aria-label="Close dialog">
            <X size={15} />
          </button>
        </div>

        {/* Tab Navigation: Standard order preserved, Current opened by default */}
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
            <span className="modal-tab-badge">{memoryCount}</span>
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
            <span className="modal-tab-badge">
              {equippedList.length + inventoryList.length}
            </span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "current"}
            className={`modal-tab-btn ${activeTab === "current" ? "active" : ""}`}
            onClick={() => setActiveTab("current")}
          >
            <Activity size={14} color={activeTab === "current" ? "var(--accent-amber)" : undefined} />
            <span>Current</span>
            <span
              className="modal-tab-badge"
              style={{
                background: "rgba(245, 158, 11, 0.2)",
                color: "var(--accent-amber)",
                borderColor: "rgba(245, 158, 11, 0.4)",
              }}
            >
              Live
            </span>
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
              {Object.keys(character.portraits ?? {}).length + (character.gallery ?? []).length}
            </span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="modal-body" style={{ overflowY: "auto", flex: 1 }}>
          {/* ========================================================================= */}
          {/* 1. Base Tab (Read-Only Reference)                                         */}
          {/* ========================================================================= */}
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
              <strong>Campaign Dossier · Read-Only Base Reference.</strong> These static traits define the character&apos;s baseline anatomy and opening scenario.
            </div>

            <CharacterBaseTab
              data={character}
              readOnly={true}
              worlds={worlds}
            />
          </div>

          {/* ========================================================================= */}
          {/* 2. Appearance Tab (Read-Only Reference)                                   */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "appearance" ? "flex" : "none",
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
              <strong>Campaign Dossier · Read-Only Appearance Reference.</strong> Distinctive features, posture, mannerisms, and visual aesthetic.
            </div>

            <CharacterAppearanceTab
              data={character}
              readOnly={true}
            />
          </div>

          {/* ========================================================================= */}
          {/* 3. Personality Tab (Read-Only Reference)                                  */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "personality" ? "flex" : "none",
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
              <strong>Campaign Dossier · Read-Only Personality Reference.</strong> Core persona, behavioral traits, moral code, and motivational baselines.
            </div>

            <CharacterPersonalityTab
              data={character}
              readOnly={true}
            />
          </div>

          {/* ========================================================================= */}
          {/* 4. Voice & Dialogue Tab (Read-Only Reference)                             */}
          {/* ========================================================================= */}
          <div
            style={{
              display: activeTab === "voice" ? "flex" : "none",
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
              <strong>Campaign Dossier · Read-Only Voice Reference.</strong> Communication style keywords and dialogue context snippets.
            </div>

            <CharacterVoiceTab
              data={character}
              readOnly={true}
            />
          </div>


          <CampaignCharacterMemoriesTab
            characterId={character.id}
            initialShards={character.memory_shards}
            isActive={activeTab === "memories"}
            onMemoriesCountChange={setMemoryCount}
            onSaveMemories={onSaveMemories}
          />

          <CampaignCharacterInventoryTab
            character={character}
            equippedList={equippedList}
            inventoryList={inventoryList}
            worldArtifactNodes={worldArtifactNodes}
            activeWorldName={activeWorld?.name}
            isMutatingLocked={isMutatingLocked}
            initialExpandedItemId={initialExpandedItemId}
            isActive={activeTab === "inventory"}
            onItemAction={onItemAction}
          />

          <CampaignCharacterStateTab
            character={character}
            state={state}
            isPresent={isPresent}
            elsewhereLocationName={elsewhereLocationName}
            characterNameMap={characterNameMap}
            isActive={activeTab === "current"}
          />

          <CampaignCharacterMediaTab
            character={character}
            isActive={activeTab === "media"}
          />
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            justifyContent: "flex-end",
            background: "var(--bg-panel)",
            borderBottomLeftRadius: 10,
            borderBottomRightRadius: 10,
          }}
        >
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
