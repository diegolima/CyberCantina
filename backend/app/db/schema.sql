PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS worlds (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    global_rules_json TEXT NOT NULL,
    pending_deletion INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS location_nodes (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    created_at_turn_id TEXT NULL,
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    description TEXT NOT NULL,
    environmental_tags_json TEXT NOT NULL DEFAULT '[]',
    is_starting_location INTEGER NOT NULL DEFAULT 0,
    is_hub INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_location_nodes_world ON location_nodes(world_id);

CREATE TABLE IF NOT EXISTS location_edges (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    from_location_id TEXT NOT NULL REFERENCES location_nodes(id) ON DELETE CASCADE,
    to_location_id TEXT NOT NULL REFERENCES location_nodes(id) ON DELETE CASCADE,
    direction_label TEXT NOT NULL,
    compass_direction TEXT NULL,
    travel_minutes INTEGER NOT NULL DEFAULT 1,
    is_locked_or_hidden INTEGER NOT NULL DEFAULT 0,
    created_at_turn_id TEXT NULL,
    superseded_at_turn_id TEXT NULL
);

CREATE INDEX IF NOT EXISTS idx_location_edges_from ON location_edges(from_location_id);

CREATE TABLE IF NOT EXISTS lore_nodes (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    entity_tags_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_lore_nodes_world ON lore_nodes(world_id);

CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    world_id TEXT NULL REFERENCES worlds(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    physical_appearance TEXT NOT NULL DEFAULT '',
    core_persona TEXT NOT NULL,
    initial_message TEXT NOT NULL DEFAULT '',
    inventory_json TEXT NOT NULL DEFAULT '[]',
    voice_anchors_json TEXT NOT NULL DEFAULT '[]',
    baseline_psyche_json TEXT NOT NULL,
    memory_shards_json TEXT NOT NULL DEFAULT '[]',
    pending_deletion INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE RESTRICT,
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
    active_leaf_turn_id TEXT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS campaign_characters (
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE RESTRICT,
    joined_at_turn_id TEXT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (campaign_id, character_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_characters_char ON campaign_characters(character_id);

CREATE TABLE IF NOT EXISTS turn_nodes (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    parent_turn_id TEXT NULL REFERENCES turn_nodes(id) ON DELETE CASCADE,
    depth_index INTEGER NOT NULL DEFAULT 0,
    user_message TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    raw_prose TEXT NOT NULL,
    cognition_json TEXT NOT NULL,
    pre_turn_json TEXT NOT NULL,
    post_turn_json TEXT NULL,
    recalled_items_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turn_nodes_campaign ON turn_nodes(campaign_id);
CREATE INDEX IF NOT EXISTS idx_turn_nodes_parent ON turn_nodes(parent_turn_id);

CREATE TABLE IF NOT EXISTS world_state_snapshots (
    turn_id TEXT PRIMARY KEY REFERENCES turn_nodes(id) ON DELETE CASCADE,
    world_timestamp TEXT NOT NULL,
    active_location_id TEXT NOT NULL REFERENCES location_nodes(id),
    scene_flags_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS character_states (
    turn_id TEXT NOT NULL REFERENCES turn_nodes(id) ON DELETE CASCADE,
    character_id TEXT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
    current_location_id TEXT NOT NULL REFERENCES location_nodes(id),
    mood_label TEXT NOT NULL,
    valence REAL NOT NULL DEFAULT 0.0,
    arousal REAL NOT NULL DEFAULT 0.4,
    active_want TEXT NOT NULL,
    active_plan TEXT NOT NULL,
    relationship_notes_json TEXT NOT NULL DEFAULT '{}',
    inventory_json TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (turn_id, character_id)
);

CREATE TABLE IF NOT EXISTS episodic_chunks (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    start_turn_depth INTEGER NOT NULL,
    end_turn_depth INTEGER NOT NULL,
    leaf_turn_id TEXT NOT NULL REFERENCES turn_nodes(id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_episodic_chunks_campaign ON episodic_chunks(campaign_id);

CREATE TABLE IF NOT EXISTS vector_entries (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL, -- 'lore' | 'character_shard' | 'episodic_chunk'
    world_id TEXT NULL,
    character_id TEXT NULL,
    campaign_id TEXT NULL,
    anchor_turn_id TEXT NULL,  -- NULL for static lore/character shards; set for branch-bound episodic memories
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    keywords_json TEXT NOT NULL DEFAULT '[]',
    embedding_blob BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_vector_entries_scope ON vector_entries(world_id, character_id, campaign_id);
