import React, { useMemo, useState } from "react";
import {
  Check,
  FolderKanban,
  Globe,
  Plus,
  Search,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import {
  CampaignRecord,
  CharacterRecord,
  PersonaRecord,
  WorldRecord,
} from "../types";
import { EntityCategory, getEntityPrimaryImage } from "../utils/entityImages";

export interface HomeEntityPickerModalProps {
  category: EntityCategory;
  personas: PersonaRecord[];
  characters: CharacterRecord[];
  worlds: WorldRecord[];
  campaigns: CampaignRecord[];
  activePersonaId?: string;
  onClose: () => void;
  onSelectCampaign: (campaign: CampaignRecord) => void;
  onSelectCharacter: (character: CharacterRecord) => void;
  onSelectWorld: (world: WorldRecord) => void;
  onSelectPersona: (persona: PersonaRecord) => void;
  onNewClick: (category: EntityCategory) => void;
}

export const HomeEntityPickerModal: React.FC<HomeEntityPickerModalProps> = ({
  category,
  personas,
  characters,
  worlds,
  campaigns,
  activePersonaId,
  onClose,
  onSelectCampaign,
  onSelectCharacter,
  onSelectWorld,
  onSelectPersona,
  onNewClick,
}) => {
  const [searchQuery, setSearchQuery] = useState("");

  const categoryMeta = useMemo(() => {
    switch (category) {
      case "personas":
        return {
          title: "Personas",
          singular: "Persona",
          icon: <UserCheck size={18} color="var(--accent-emerald)" />,
          accentColor: "var(--accent-emerald)",
        };
      case "characters":
        return {
          title: "Characters",
          singular: "Character",
          icon: <Users size={18} color="var(--accent-amber)" />,
          accentColor: "var(--accent-amber)",
        };
      case "worlds":
        return {
          title: "Worlds",
          singular: "World",
          icon: <Globe size={18} color="var(--accent-cyan)" />,
          accentColor: "var(--accent-cyan)",
        };
      case "campaigns":
        return {
          title: "Campaigns",
          singular: "Campaign",
          icon: <FolderKanban size={18} color="var(--accent-violet)" />,
          accentColor: "var(--accent-violet)",
        };
    }
  }, [category]);

  const worldMap = useMemo(() => {
    const map = new Map<string, WorldRecord>();
    worlds.forEach((w) => map.set(w.id, w));
    return map;
  }, [worlds]);

  const charMap = useMemo(() => {
    const map = new Map<string, CharacterRecord>();
    characters.forEach((c) => map.set(c.id, c));
    return map;
  }, [characters]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    switch (category) {
      case "personas":
        return personas.filter(
          (p) =>
            !q ||
            p.name.toLowerCase().includes(q) ||
            (p.physical_appearance && p.physical_appearance.toLowerCase().includes(q))
        );
      case "characters":
        return characters.filter(
          (c) =>
            !q ||
            c.name.toLowerCase().includes(q) ||
            (c.tagline && c.tagline.toLowerCase().includes(q)) ||
            (c.tags && c.tags.some((t) => t.toLowerCase().includes(q)))
        );
      case "worlds":
        return worlds.filter(
          (w) =>
            !q ||
            w.name.toLowerCase().includes(q) ||
            (w.global_rules?.genre && w.global_rules.genre.toLowerCase().includes(q))
        );
      case "campaigns":
        return campaigns.filter((camp) => {
          if (!q) return true;
          const matchName = camp.name.toLowerCase().includes(q);
          const w = worldMap.get(camp.world_id);
          const c = charMap.get(camp.character_id);
          const matchWorld = w?.name.toLowerCase().includes(q);
          const matchChar = c?.name.toLowerCase().includes(q);
          return Boolean(matchName || matchWorld || matchChar);
        });
    }
  }, [category, personas, characters, worlds, campaigns, searchQuery, worldMap, charMap]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel"
        style={{ width: "min(720px, 94vw)", maxHeight: "88vh", display: "flex", flexDirection: "column" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {categoryMeta.icon}
            <span style={{ fontWeight: 700, fontSize: "1.05rem" }}>
              Select {categoryMeta.singular}
            </span>
            <span
              style={{
                fontSize: "0.72rem",
                color: "var(--text-muted)",
                background: "rgba(255, 255, 255, 0.05)",
                padding: "2px 8px",
                borderRadius: 9999,
                border: "1px solid var(--border-subtle)",
              }}
            >
              {filteredItems.length} available
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                fontSize: "0.75rem",
                borderColor: categoryMeta.accentColor,
              }}
              onClick={() => {
                onClose();
                onNewClick(category);
              }}
              title={`Create new ${categoryMeta.singular}`}
            >
              <Plus size={12} color={categoryMeta.accentColor} />
              <span>New {categoryMeta.singular}</span>
            </button>
            <button type="button" className="btn" onClick={onClose} title="Close">
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div style={{ padding: "12px 18px 4px 18px", flexShrink: 0 }}>
          <div className="sidebar-search-wrap" style={{ margin: 0 }}>
            <Search size={14} className="sidebar-search-icon" />
            <input
              type="text"
              className="sidebar-search-input"
              placeholder={`Search ${categoryMeta.title.toLowerCase()}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Items List */}
        <div
          className="modal-body"
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "12px 18px 18px 18px",
          }}
        >
          {filteredItems.length === 0 ? (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "var(--text-muted)",
                fontSize: "0.85rem",
              }}
            >
              <div style={{ marginBottom: 12, opacity: 0.5 }}>
                {categoryMeta.icon}
              </div>
              {searchQuery.trim() ? (
                <div>No {categoryMeta.title.toLowerCase()} match "{searchQuery}"</div>
              ) : (
                <div>
                  No {categoryMeta.title.toLowerCase()} created yet.
                  <div style={{ marginTop: 12 }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        onClose();
                        onNewClick(category);
                      }}
                    >
                      <Plus size={13} /> Create First {categoryMeta.singular}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            filteredItems.map((item: any) => {
              if (category === "campaigns") {
                const camp = item as CampaignRecord;
                const world = worldMap.get(camp.world_id);
                const char = charMap.get(camp.character_id);
                const charImg = char ? getEntityPrimaryImage("characters", char) : null;

                return (
                  <div
                    key={camp.id}
                    className="home-picker-item"
                    onClick={() => {
                      onClose();
                      onSelectCampaign(camp);
                    }}
                  >
                    <div className="home-picker-thumb">
                      {charImg ? (
                        <img src={charImg} alt={char?.name || ""} />
                      ) : (
                        <FolderKanban size={20} color="var(--accent-violet)" />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="home-picker-item-title">{camp.name}</div>
                      <div className="home-picker-item-sub">
                        <span>Companion: <strong style={{ color: "var(--accent-amber)" }}>{char?.name ?? "Unknown"}</strong></span>
                        <span>•</span>
                        <span>World: <strong style={{ color: "var(--accent-cyan)" }}>{world?.name ?? "Unknown"}</strong></span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-amber"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                        onSelectCampaign(camp);
                      }}
                    >
                      Launch
                    </button>
                  </div>
                );
              }

              if (category === "characters") {
                const char = item as CharacterRecord;
                const img = getEntityPrimaryImage("characters", char);

                return (
                  <div
                    key={char.id}
                    className="home-picker-item"
                    onClick={() => {
                      onClose();
                      onSelectCharacter(char);
                    }}
                  >
                    <div className="home-picker-thumb">
                      {img ? (
                        <img src={img} alt={char.name} />
                      ) : (
                        <Users size={20} color="var(--accent-amber)" />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="home-picker-item-title">{char.name}</div>
                      <div className="home-picker-item-sub">
                        {char.tagline || char.core_persona || "AI Actor"}
                      </div>
                      {char.tags && char.tags.length > 0 && (
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                          {char.tags.slice(0, 4).map((tag) => (
                            <span key={tag} className="tag-chip" style={{ fontSize: "0.64rem", padding: "1px 5px" }}>
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                        onSelectCharacter(char);
                      }}
                    >
                      Inspect
                    </button>
                  </div>
                );
              }

              if (category === "worlds") {
                const world = item as WorldRecord;
                const img = getEntityPrimaryImage("worlds", world);

                return (
                  <div
                    key={world.id}
                    className="home-picker-item"
                    onClick={() => {
                      onClose();
                      onSelectWorld(world);
                    }}
                  >
                    <div className="home-picker-thumb">
                      {img ? (
                        <img src={img} alt={world.name} />
                      ) : (
                        <Globe size={20} color="var(--accent-cyan)" />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="home-picker-item-title">{world.name}</div>
                      <div className="home-picker-item-sub">
                        <span>Genre: <strong>{world.global_rules?.genre || "Generic"}</strong></span>
                        <span>•</span>
                        <span>{world.locations?.length ?? 0} locations</span>
                        <span>•</span>
                        <span>{world.edges?.length ?? 0} links</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                        onSelectWorld(world);
                      }}
                    >
                      Inspect
                    </button>
                  </div>
                );
              }

              if (category === "personas") {
                const persona = item as PersonaRecord;
                const isActive = activePersonaId === persona.id;
                const img = getEntityPrimaryImage("personas", persona);

                return (
                  <div
                    key={persona.id}
                    className={`home-picker-item ${isActive ? "active-persona" : ""}`}
                    onClick={() => {
                      onClose();
                      onSelectPersona(persona);
                    }}
                  >
                    <div className="home-picker-thumb">
                      {img ? (
                        <img src={img} alt={persona.name} />
                      ) : (
                        <UserCheck size={20} color="var(--accent-emerald)" />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="home-picker-item-title">{persona.name}</span>
                        {isActive && (
                          <span
                            style={{
                              fontSize: "0.65rem",
                              color: "var(--accent-emerald)",
                              border: "1px solid var(--accent-emerald)",
                              padding: "1px 5px",
                              borderRadius: 4,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 3,
                            }}
                          >
                            <Check size={10} /> Active
                          </span>
                        )}
                      </div>
                      <div className="home-picker-item-sub">
                        {persona.physical_appearance || "Player Persona"}
                        {persona.lore_entries ? ` • ${persona.lore_entries.length} lore entries` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClose();
                        onSelectPersona(persona);
                      }}
                    >
                      Edit
                    </button>
                  </div>
                );
              }

              return null;
            })
          )}
        </div>
      </div>
    </div>
  );
};
