# Cross-Layer API, Schema & Package Index

## 1. FastAPI Routes <-> Frontend API Client Matrix

| Method | Path | Backend Handler | Response Schema | Frontend Client |
| :--- | :--- | :--- | :--- | :--- |
| `POST` | `/api/admin/embeddings/reindex` | `app.routers.settings.reindex_embeddings` | `dict` | `frontend/src/api/settings.ts` |
| `GET` | `/api/admin/embeddings/status` | `app.routers.settings.embedding_status` | `dict` | `frontend/src/api/settings.ts` |
| `GET` | `/api/admin/users` | `app.routers.auth.admin_list_users` | `list` | `frontend/src/api/auth.ts` |
| `POST` | `/api/admin/users` | `app.routers.auth.admin_create_user` | `UserProfile` | `frontend/src/api/auth.ts` |
| `DELETE` | `/api/admin/users/{user_id}` | `app.routers.auth.admin_delete_user` | `dict` | `frontend/src/api/auth.ts` |
| `POST` | `/api/admin/users/{user_id}/reset-password` | `app.routers.auth.admin_reset_user_password` | `AdminResetPasswordResponse` | `frontend/src/api/auth.ts` |
| `PUT` | `/api/admin/users/{user_id}/username` | `app.routers.auth.admin_change_username` | `UserProfile` | `frontend/src/api/auth.ts` |
| `POST` | `/api/auth/login` | `app.routers.auth.login_with_password` | `AuthSessionResponse` | `frontend/src/api/auth.ts` |
| `POST` | `/api/auth/logout` | `app.routers.auth.logout_user` | `dict` | `frontend/src/api/auth.ts` |
| `POST` | `/api/auth/passkey/login/finish` | `app.routers.auth.finish_passkey_login` | `AuthSessionResponse` | `frontend/src/api/auth.ts` |
| `POST` | `/api/auth/passkey/login/start` | `app.routers.auth.start_passkey_login` | `PasskeyLoginStartResponse` | `frontend/src/api/auth.ts` |
| `POST` | `/api/auth/register` | `app.routers.auth.register_user` | `AuthSessionResponse` | `frontend/src/api/auth.ts` |
| `POST` | `/api/auth/setup` | `app.routers.auth.initial_setup` | `AuthSessionResponse` | `frontend/src/api/auth.ts` |
| `GET` | `/api/auth/status` | `app.routers.auth.get_auth_status` | `AuthStatusResponse` | `frontend/src/api/auth.ts` |
| `GET` | `/api/campaigns` | `app.routers.campaign_routes.crud_and_state.list_campaigns` | `list` | `frontend/src/api/campaigns.ts` |
| `POST` | `/api/campaigns` | `app.routers.campaign_routes.crud_and_state.create_campaign` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `DELETE` | `/api/campaigns/{campaign_id}` | `app.routers.campaign_routes.crud_and_state.delete_campaign` | `dict` | `frontend/src/api/campaigns.ts` |
| `POST` | `/api/campaigns/{campaign_id}/characters` | `app.routers.campaign_routes.crud_and_state.add_campaign_character` | `CampaignStateBundle` | *(backend-only / test / SSE)* |
| `POST` | `/api/campaigns/{campaign_id}/characters/{character_id}/memories` | `app.routers.campaign_routes.crud_and_state.update_campaign_character_memories` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `POST` | `/api/campaigns/{campaign_id}/checkout` | `app.routers.campaign_routes.crud_and_state.checkout_campaign_branch` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `PUT` | `/api/campaigns/{campaign_id}/containers/{container_id}/lore` | `app.routers.campaign_routes.spatial_routes.update_campaign_container_lore` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `POST` | `/api/campaigns/{campaign_id}/edges` | `app.routers.campaign_routes.spatial_routes.connect_campaign_locations` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `DELETE` | `/api/campaigns/{campaign_id}/edges/{edge_id}` | `app.routers.campaign_routes.spatial_routes.remove_campaign_edge` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `PATCH` | `/api/campaigns/{campaign_id}/edges/{edge_id}` | `app.routers.campaign_routes.spatial_routes.update_campaign_edge_distance` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `POST` | `/api/campaigns/{campaign_id}/item-equip` | `app.routers.campaign_routes.crud_and_state.toggle_campaign_item_equip` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `POST` | `/api/campaigns/{campaign_id}/location-override` | `app.routers.campaign_routes.crud_and_state.override_campaign_location` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `POST` | `/api/campaigns/{campaign_id}/locations` | `app.routers.campaign_routes.spatial_routes.create_campaign_linked_location` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `PUT` | `/api/campaigns/{campaign_id}/locations/{location_id}/lore` | `app.routers.campaign_routes.spatial_routes.update_campaign_location_lore` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `PUT` | `/api/campaigns/{campaign_id}/map` | `app.routers.campaign_routes.spatial_routes.update_campaign_map` | `CampaignStateBundle` | `frontend/src/api/worlds.ts` |
| `GET` | `/api/campaigns/{campaign_id}/persona-state` | `app.routers.campaign_routes.crud_and_state.get_campaign_player_turn_state` | `Union` | `frontend/src/api/campaigns.ts` |
| `PUT` | `/api/campaigns/{campaign_id}/prompt-preset` | `app.routers.prompts.set_campaign_prompt_preset` | `CampaignRecord` | `frontend/src/api/prompts.ts` |
| `GET` | `/api/campaigns/{campaign_id}/state` | `app.routers.campaign_routes.crud_and_state.get_campaign_state` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `POST` | `/api/campaigns/{campaign_id}/turns` | `app.routers.campaign_routes.turn_streaming.submit_campaign_turn_sync` | `CampaignStateBundle` | *(backend-only / test / SSE)* |
| `DELETE` | `/api/campaigns/{campaign_id}/turns/last` | `app.routers.campaign_routes.crud_and_state.delete_campaign_last_turn` | `CampaignStateBundle` | `frontend/src/api/campaigns.ts` |
| `POST` | `/api/campaigns/{campaign_id}/turns/stream` | `app.routers.campaign_routes.turn_streaming.stream_campaign_turn` | — | `frontend/src/api/stream.ts` |
| `DELETE` | `/api/campaigns/{campaign_id}/turns/{turn_id}` | `app.routers.campaign_routes.crud_and_state.delete_campaign_turn` | `CampaignStateBundle` | *(backend-only / test / SSE)* |
| `GET` | `/api/characters` | `app.routers.characters.list_characters` | `list` | `frontend/src/api/characters.ts` |
| `DELETE` | `/api/characters/{character_id}` | `app.routers.characters.delete_character` | `dict` | `frontend/src/api/characters.ts` |
| `GET` | `/api/characters/{character_id}` | `app.routers.characters.get_character` | `CharacterRecord` | `frontend/src/api/characters.ts` |
| `PUT` | `/api/characters/{character_id}` | `app.routers.characters.update_character` | `CharacterRecord` | `frontend/src/api/characters.ts` |
| `POST` | `/api/characters/{character_id}/gallery` | `app.routers.characters.upload_character_gallery_image` | `CharacterRecord` | `frontend/src/api/characters.ts` |
| `DELETE` | `/api/characters/{character_id}/gallery/{image_id}` | `app.routers.characters.delete_character_gallery_image` | `CharacterRecord` | `frontend/src/api/characters.ts` |
| `DELETE` | `/api/characters/{character_id}/portraits/{emotion}` | `app.routers.characters.delete_character_portrait` | `CharacterRecord` | `frontend/src/api/characters.ts` |
| `POST` | `/api/characters/{character_id}/portraits/{emotion}` | `app.routers.characters.upload_character_portrait` | `CharacterRecord` | `frontend/src/api/characters.ts` |
| `GET` | `/api/characters/{character_id}/versions` | `app.routers.characters.list_character_versions` | `list` | `frontend/src/api/characters.ts` |
| `GET` | `/api/characters/{character_id}/versions/{version}` | `app.routers.characters.get_character_version` | `CharacterRecord` | `frontend/src/api/characters.ts` |
| `POST` | `/api/characters/{character_id}/versions/{version}/restore` | `app.routers.characters.restore_character_version` | `CharacterRecord` | `frontend/src/api/characters.ts` |
| `POST` | `/api/enrich` | `app.routers.enrich.enrich_text` | `PromptEnrichResponse` | `frontend/src/api/settings.ts` |
| `POST` | `/api/export/bundle` | `app.routers.import_export.export_bundle` | — | `frontend/src/api/importExport.ts` |
| `GET` | `/api/export/character/{character_id}` | `app.routers.import_export.export_single_character` | — | `frontend/src/api/importExport.ts` |
| `GET` | `/api/export/world/{world_id}` | `app.routers.import_export.export_single_world` | — | `frontend/src/api/importExport.ts` |
| `GET` | `/api/health` | `app.routers.settings.health_check` | `dict` | *(backend-only / test / SSE)* |
| `POST` | `/api/import/commit` | `app.routers.import_export.commit_import` | `ImportCommitResponse` | `frontend/src/api/importExport.ts` |
| `POST` | `/api/import/inspect` | `app.routers.import_export.inspect_import` | `ImportInspectResponse` | `frontend/src/api/importExport.ts` |
| `GET` | `/api/local-relay/status` | `app.routers.local_relay.get_local_relay_status` | `dict` | `frontend/src/api/providers.ts` |
| `WS` | `/api/local-relay/ws` | `app.routers.local_relay.local_relay_ws` | — | *(backend-only / test / SSE)* |
| `POST` | `/api/mechanics/choice-preview` | `app.routers.mechanics.preview_choices` | `ChoicePreviewResponse` | `frontend/src/api/campaigns.ts` |
| `GET` | `/api/media/characters/{character_id}/{category}/{filename}` | `app.routers.characters.get_character_media` | — | *(backend-only / test / SSE)* |
| `GET` | `/api/notes` | `app.routers.notes.list_my_notes` | `list` | `frontend/src/api/notes.ts` |
| `POST` | `/api/notes` | `app.routers.notes.create_my_note` | `UserNoteRecord` | `frontend/src/api/notes.ts` |
| `DELETE` | `/api/notes/{note_id}` | `app.routers.notes.delete_my_note` | `dict` | `frontend/src/api/notes.ts` |
| `GET` | `/api/notes/{note_id}` | `app.routers.notes.get_my_note` | `UserNoteRecord` | `frontend/src/api/notes.ts` |
| `PUT` | `/api/notes/{note_id}` | `app.routers.notes.update_my_note` | `UserNoteRecord` | `frontend/src/api/notes.ts` |
| `GET` | `/api/ollama/status` | `app.routers.settings.get_ollama_status` | `OllamaStatusResponse` | *(backend-only / test / SSE)* |
| `GET` | `/api/personas` | `app.routers.personas.list_user_personas` | `list` | `frontend/src/api/personas.ts` |
| `POST` | `/api/personas` | `app.routers.personas.create_persona` | `PersonaRecord` | `frontend/src/api/personas.ts` |
| `DELETE` | `/api/personas/{persona_id}` | `app.routers.personas.delete_persona` | — | `frontend/src/api/personas.ts` |
| `GET` | `/api/personas/{persona_id}` | `app.routers.personas.get_persona` | `PersonaRecord` | `frontend/src/api/personas.ts` |
| `PUT` | `/api/personas/{persona_id}` | `app.routers.personas.update_persona` | `PersonaRecord` | `frontend/src/api/personas.ts` |
| `DELETE` | `/api/profile` | `app.routers.auth.delete_my_account` | `dict` | `frontend/src/api/auth.ts` |
| `GET` | `/api/profile` | `app.routers.auth.get_my_profile` | `UserProfile` | `frontend/src/api/auth.ts` |
| `PUT` | `/api/profile` | `app.routers.auth.update_my_profile` | `UserProfile` | `frontend/src/api/auth.ts` |
| `POST` | `/api/profile/delete` | `app.routers.auth.delete_my_account` | `dict` | *(backend-only / test / SSE)* |
| `DELETE` | `/api/profile/models` | `app.routers.settings.reset_profile_models` | `ProfileModelSettingsResponse` | `frontend/src/api/settings.ts` |
| `GET` | `/api/profile/models` | `app.routers.settings.get_profile_models` | `ProfileModelSettingsResponse` | `frontend/src/api/settings.ts` |
| `PUT` | `/api/profile/models` | `app.routers.settings.update_profile_models` | `ProfileModelSettingsResponse` | `frontend/src/api/settings.ts` |
| `POST` | `/api/profile/passkeys/register/finish` | `app.routers.auth.finish_passkey_registration` | `UserProfile` | `frontend/src/api/auth.ts` |
| `POST` | `/api/profile/passkeys/register/start` | `app.routers.auth.start_passkey_registration` | `PasskeyRegisterStartResponse` | `frontend/src/api/auth.ts` |
| `POST` | `/api/profile/passkeys/{credential_id}/delete` | `app.routers.auth.delete_my_passkey` | `UserProfile` | `frontend/src/api/auth.ts` |
| `POST` | `/api/profile/password` | `app.routers.auth.change_my_password` | `AuthStatusResponse` | `frontend/src/api/auth.ts` |
| `POST` | `/api/profile/reset-data` | `app.routers.auth.reset_my_data` | `dict` | `frontend/src/api/auth.ts` |
| `GET` | `/api/prompts/active` | `app.routers.prompts.get_active_prompt_preset` | `dict` | `frontend/src/api/prompts.ts` |
| `PUT` | `/api/prompts/active` | `app.routers.prompts.set_active_prompt_preset` | `dict` | `frontend/src/api/prompts.ts` |
| `GET` | `/api/prompts/defaults` | `app.routers.prompts.get_prompt_defaults` | `PromptDefaultsResponse` | `frontend/src/api/prompts.ts` |
| `GET` | `/api/prompts/presets` | `app.routers.prompts.list_prompt_presets` | `list` | `frontend/src/api/prompts.ts` |
| `POST` | `/api/prompts/presets` | `app.routers.prompts.create_prompt_preset` | `PromptPresetRecord` | `frontend/src/api/prompts.ts` |
| `DELETE` | `/api/prompts/presets/{preset_id}` | `app.routers.prompts.delete_prompt_preset` | `dict` | `frontend/src/api/prompts.ts` |
| `GET` | `/api/prompts/presets/{preset_id}` | `app.routers.prompts.get_prompt_preset` | `PromptPresetRecord` | `frontend/src/api/prompts.ts` |
| `PUT` | `/api/prompts/presets/{preset_id}` | `app.routers.prompts.update_prompt_preset` | `PromptPresetRecord` | `frontend/src/api/prompts.ts` |
| `POST` | `/api/prompts/presets/{preset_id}/reset` | `app.routers.prompts.reset_prompt_preset` | `PromptPresetRecord` | `frontend/src/api/prompts.ts` |
| `GET` | `/api/providers` | `app.routers.providers.list_providers` | `list` | `frontend/src/api/providers.ts` |
| `POST` | `/api/providers` | `app.routers.providers.create_provider` | `ProviderResponse` | `frontend/src/api/providers.ts` |
| `POST` | `/api/providers/probe-draft` | `app.routers.providers.probe_draft` | `ProviderProbeResponse` | `frontend/src/api/providers.ts` |
| `DELETE` | `/api/providers/{provider_id}` | `app.routers.providers.delete_provider` | — | `frontend/src/api/providers.ts` |
| `PUT` | `/api/providers/{provider_id}` | `app.routers.providers.update_provider` | `ProviderResponse` | `frontend/src/api/providers.ts` |
| `POST` | `/api/providers/{provider_id}/client-probe` | `app.routers.providers.report_client_probe` | `ProviderProbeResponse` | `frontend/src/api/providers.ts` |
| `POST` | `/api/providers/{provider_id}/probe` | `app.routers.providers.probe_provider` | `ProviderProbeResponse` | *(backend-only / test / SSE)* |
| `GET` | `/api/settings` | `app.routers.settings.get_settings` | `AppSettings` | `frontend/src/api/settings.ts` |
| `PUT` | `/api/settings` | `app.routers.settings.update_settings` | `SettingsUpdateResponse` | `frontend/src/api/settings.ts` |
| `POST` | `/api/wizards/character/commit` | `app.routers.characters.wizard_commit_character` | `CharacterRecord` | `frontend/src/api/characters.ts` |
| `POST` | `/api/wizards/character/draft` | `app.routers.characters.wizard_draft_character` | `CharacterWizardDraft` | `frontend/src/api/characters.ts` |
| `POST` | `/api/wizards/character/extract-features` | `app.routers.characters.extract_character_features` | `CharacterFeatureExtractionResponse` | `frontend/src/api/characters.ts` |
| `POST` | `/api/wizards/character/extract-persona-traits` | `app.routers.characters.extract_character_persona_traits` | `CharacterPersonaExtractionResponse` | `frontend/src/api/characters.ts` |
| `POST` | `/api/wizards/character/extract-quirks` | `app.routers.characters.extract_character_quirks` | `CharacterQuirksExtractionResponse` | `frontend/src/api/characters.ts` |
| `POST` | `/api/wizards/character/import-sillytavern` | `app.routers.characters.wizard_import_sillytavern_card` | `SillyTavernImportResponse` | `frontend/src/api/characters.ts` |
| `POST` | `/api/wizards/world/commit` | `app.routers.worlds.wizard_commit_world` | `WorldRecord` | `frontend/src/api/worlds.ts` |
| `POST` | `/api/wizards/world/draft` | `app.routers.worlds.wizard_draft_world` | `WorldWizardDraft` | `frontend/src/api/worlds.ts` |
| `POST` | `/api/wizards/world/reimagine-map` | `app.routers.worlds.wizard_reimagine_map` | `WorldMapDraft` | `frontend/src/api/worlds.ts` |
| `GET` | `/api/worlds` | `app.routers.worlds.list_worlds` | `list` | `frontend/src/api/worlds.ts` |
| `DELETE` | `/api/worlds/{world_id}` | `app.routers.worlds.delete_world` | `dict` | `frontend/src/api/worlds.ts` |
| `GET` | `/api/worlds/{world_id}` | `app.routers.worlds.get_world` | `WorldRecord` | `frontend/src/api/worlds.ts` |
| `PUT` | `/api/worlds/{world_id}` | `app.routers.worlds.update_world` | `WorldRecord` | `frontend/src/api/worlds.ts` |
| `DELETE` | `/api/worlds/{world_id}/containers/{container_id}` | `app.routers.worlds.delete_world_container` | `WorldRecord` | *(backend-only / test / SSE)* |
| `POST` | `/api/worlds/{world_id}/locations/{location_id}/convert-to-container` | `app.routers.worlds.convert_location_to_container` | `WorldRecord` | `frontend/src/api/worlds.ts` |

## 2. SQLite Schema (`backend/app/db/schema.sql`)

```mermaid
erDiagram
    campaigns ||--o{ campaign_character_memories : references
    characters ||--o{ campaign_character_memories : references
    campaigns ||--o{ campaign_characters : references
    characters ||--o{ campaign_characters : references
    campaigns ||--o{ campaign_container_lore_overrides : references
    location_containers ||--o{ campaign_container_lore_overrides : references
    campaigns ||--o{ campaign_location_lore_overrides : references
    location_nodes ||--o{ campaign_location_lore_overrides : references
    campaigns ||--o{ campaign_spatial_overrides : references
    turn_nodes ||--o{ campaign_spatial_overrides : references
    characters ||--o{ campaigns : references
    personas ||--o{ campaigns : references
    prompt_presets ||--o{ campaigns : references
    users ||--o{ campaigns : references
    worlds ||--o{ campaigns : references
    characters ||--o{ character_states : references
    location_nodes ||--o{ character_states : references
    turn_nodes ||--o{ character_states : references
    characters ||--o{ character_versions : references
    users ||--o{ characters : references
    worlds ||--o{ characters : references
    campaigns ||--o{ episodic_chunks : references
    turn_nodes ||--o{ episodic_chunks : references
    location_containers ||--o{ location_containers : references
    worlds ||--o{ location_containers : references
    location_nodes ||--o{ location_edges : references
    worlds ||--o{ location_edges : references
    location_containers ||--o{ location_nodes : references
    worlds ||--o{ location_nodes : references
    campaigns ||--o{ lore_nodes : references
    location_containers ||--o{ lore_nodes : references
    location_nodes ||--o{ lore_nodes : references
    worlds ||--o{ lore_nodes : references
    turn_nodes ||--o{ persona_turn_states : references
    users ||--o{ personas : references
    users ||--o{ prompt_presets : references
    users ||--o{ providers : references
    users ||--o{ staged_character_ownership : references
    campaigns ||--o{ turn_nodes : references
    turn_nodes ||--o{ turn_nodes : references
    prompt_presets ||--o{ user_model_settings : references
    users ||--o{ user_model_settings : references
    users ||--o{ user_notes : references
    users ||--o{ user_passkeys : references
    users ||--o{ user_sessions : references
    users ||--o{ webauthn_challenges : references
    location_nodes ||--o{ world_state_snapshots : references
    turn_nodes ||--o{ world_state_snapshots : references
    users ||--o{ worlds : references
```

| Table | Foreign-Key Parents |
| :--- | :--- |
| `users` | — |
| `user_passkeys` | `users` |
| `user_sessions` | `users` |
| `prompt_presets` | `users` |
| `user_model_settings` | `prompt_presets`, `users` |
| `worlds` | `users` |
| `location_containers` | `location_containers`, `worlds` |
| `location_nodes` | `location_containers`, `worlds` |
| `location_edges` | `location_nodes`, `worlds` |
| `characters` | `users`, `worlds` |
| `character_versions` | `characters` |
| `personas` | `users` |
| `campaigns` | `characters`, `personas`, `prompt_presets`, `users`, `worlds` |
| `campaign_characters` | `campaigns`, `characters` |
| `campaign_character_memories` | `campaigns`, `characters` |
| `lore_nodes` | `campaigns`, `location_containers`, `location_nodes`, `worlds` |
| `campaign_location_lore_overrides` | `campaigns`, `location_nodes` |
| `campaign_container_lore_overrides` | `campaigns`, `location_containers` |
| `turn_nodes` | `campaigns`, `turn_nodes` |
| `world_state_snapshots` | `location_nodes`, `turn_nodes` |
| `campaign_spatial_overrides` | `campaigns`, `turn_nodes` |
| `character_states` | `characters`, `location_nodes`, `turn_nodes` |
| `persona_turn_states` | `turn_nodes` |
| `episodic_chunks` | `campaigns`, `turn_nodes` |
| `vector_entries` | — |
| `user_notes` | `users` |
| `staged_character_ownership` | `users` |
| `webauthn_challenges` | `users` |
| `app_meta` | — |
| `providers` | `users` |

## 3. Domain Package File Index

### Backend (`backend/app/`)

#### `app`

| File | Summary |
| :--- | :--- |
| `backend/app/__init__.py` | CyberCantina Backend Application. |

#### `app.auth`

| File | Summary |
| :--- | :--- |
| `backend/app/auth.py` | Authentication, Password Hashing (Argon2id), WebAuthn Passkeys, and 24h Sliding Sessions. |

#### `app.config`

| File | Summary |
| :--- | :--- |
| `backend/app/config.py` | Configuration management for CyberCantina LLM roles and memory settings. |

#### `app.db`

| File | Summary |
| :--- | :--- |
| `backend/app/db/__init__.py` | Database, graph repository, and vector store layer. |
| `backend/app/db/provider_store.py` | SQLite persistence for LLM providers (tenant-scoped, optimistic concurrency, sealed secrets). |
| `backend/app/db/repository.py` | Branch-aware SQLite repository for Worlds, Characters, Spatial Graph, and Turn Trees. |
| `backend/app/db/seed.py` | Default showcase scenario seeder ('Midnight at the Neon Rust'). |
| `backend/app/db/vector_math.py` | Embedding helpers, lexical TF-IDF activations, MMR, and RRF math. |
| `backend/app/db/vector_store.py` | Hybrid semantic vector store and branch-aware memory retrieval. |

#### `app.db.repos`

| File | Summary |
| :--- | :--- |
| `backend/app/db/repos/__init__.py` | Domain repository mixins composed into CantinaRepository. |
| `backend/app/db/repos/auth_users.py` | Users, passkeys, sessions, and per-user model settings persistence. |
| `backend/app/db/repos/base.py` | Core SQLite connection, media helpers, and vector/provider bindings. |
| `backend/app/db/repos/campaign_lore_items.py` | Campaign item equip toggles and location/container lore overrides. |
| `backend/app/db/repos/campaign_map_update.py` | Campaign full map bulk update and spatial synchronization. |
| `backend/app/db/repos/campaign_spatial.py` | Campaign location overrides, edges, spatial projections, and row mappers. |
| `backend/app/db/repos/campaigns.py` | Campaign creation, membership, and prompt preset assignment. |
| `backend/app/db/repos/character_versions.py` | Character updates, version history snapshots/restores, and campaign memory edits. |
| `backend/app/db/repos/characters.py` | Character creation, access checks, media staging, portraits/gallery, and soft-deletion. |
| `backend/app/db/repos/notes.py` | User notes persistence and row mapping. |
| `backend/app/db/repos/personas.py` | Player personas and dynamic campaign persona turn state. |
| `backend/app/db/repos/prompt_presets.py` | Prompt preset CRUD and effective prompt resolution. |
| `backend/app/db/repos/schema_init.py` | SQLite DDL initialization and legacy schema migrations. |
| `backend/app/db/repos/turns.py` | Turn tree persistence, episodic chunks, branch checkout, and state bundles. |
| `backend/app/db/repos/world_locations.py` | Location containers, neighbors, and improvised location creation. |
| `backend/app/db/repos/worlds.py` | World CRUD, scoped lore helpers, and pending-deletion pruning. |

#### `app.dependencies`

| File | Summary |
| :--- | :--- |
| `backend/app/dependencies.py` | Shared dependency injection, configuration resolution, and media utilities. |

#### `app.engine`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/__init__.py` | 4-Phase Agentic Turn Execution Engine. |

#### `app.engine.affective`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/affective/__init__.py` | CARE-v1 affective mathematics, lexical rendering, and post-turn appraisal package. |
| `backend/app/engine/affective/dynamics.py` | Continuous decay, Kalman mood updates, composure masking, and Gottman steps. |
| `backend/app/engine/affective/hydration.py` | Legacy snapshot hydration, seeding, and CARE state materialization. |
| `backend/app/engine/affective/lexical.py` | Lexical rendering (zero-raw-float PAD/CARE/edge descriptions for Zone 4). |
| `backend/app/engine/affective/models.py` | Mathematical constants, dataclasses, and low-level CARE helpers. |
| `backend/app/engine/affective/post_turn.py` | Post-turn CARE appraisal, salience clamping, and witness coupling. |

#### `app.engine.affective_engine`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/affective_engine.py` | CARE-v1 Affective Mathematics, Lexical Rendering, Hydration & Post-Turn Appraisal Engine. |

#### `app.engine.char_agent`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/char_agent/__init__.py` | Character Post-Turn State & Inventory Arbitration package. |
| `backend/app/engine/char_agent/agent.py` | Heuristic delta extraction and LLM character post-turn state agent. |
| `backend/app/engine/char_agent/inventory.py` | Permanent item locking, character inventory deltas, and contest arbitration. |
| `backend/app/engine/char_agent/matching.py` | Item token matching, mood normalization, and relationship stance formatting. |

#### `app.engine.character_agent`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/character_agent.py` | Character State Agent & Inventory Arbitration. |

#### `app.engine.choices`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/choices.py` | Pure engine logic, deterministic condition gating, and compliance for Director Choices. |

#### `app.engine.clerk`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/clerk/__init__.py` | Phase 5 async post-turn clerk & character state package. |
| `backend/app/engine/clerk/episodic.py` | Episodic chunk witnesses, salience scoring, and structured LLM chunk summarization. |
| `backend/app/engine/clerk/gossip.py` | Scene-flag merging, prose-verified persona gossip exchange, and persona unlock tracking. |
| `backend/app/engine/clerk/heuristics.py` | Offline heuristic post-turn world and spatial/inventory delta extraction. |
| `backend/app/engine/clerk/inventory.py` | Inventory item normalization, removal matching, merging, and heuristic item deltas. |
| `backend/app/engine/clerk/memories.py` | Heuristic character memory extraction, deduplication, resolution, and compaction. |
| `backend/app/engine/clerk/pipeline.py` | Phase 5 async post-turn clerk orchestrator and passive bystander fast-pathing. |

#### `app.engine.clerk_placement`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/clerk_placement.py` | Clerk Scene Staging Engine for World-focused Campaign Starts. |

#### `app.engine.cognition`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/cognition/__init__.py` | Phase 3 Character Cognition & Hidden Thought Generation package. |
| `backend/app/engine/cognition/heuristics.py` | Offline heuristic cognition fallback and episodic memory recall selection. |
| `backend/app/engine/cognition/runner.py` | Phase 3 character cognition LLM execution and multi-actor orchestration. |
| `backend/app/engine/cognition/xml_parser.py` | Cognition XML parsing, feeling attribute extraction, and text sanitization. |

#### `app.engine.context`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/context/__init__.py` | Phase 2 context scoping, Zone 1-4 prompt building, and turn bundle assembly. |
| `backend/app/engine/context/assembler.py` | Phase 2 turn context resolver and 4-zone prompt message assembler. |
| `backend/app/engine/context/lore_scope.py` | Token budget estimation, actor context ceilings, working windows, container chains, and lore scoping. |
| `backend/app/engine/context/zone1_static.py` | Zone 1 KV-cached static system prompt assembly and discovered-persona views. |
| `backend/app/engine/context/zone2_episodic.py` | Zone 2 LOD episodic memory rendering, vector recall packing, and compacted turn elevation. |
| `backend/app/engine/context/zone4_ephemeral.py` | Zone 4 ephemeral tail frame and elapsed snapshot state projection. |

#### `app.engine.llm_client`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/llm_client.py` | Ollama-first & OpenAI-compatible LLM client with model discovery and grammar-constrained JSON. |

#### `app.engine.mentions`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/mentions.py` | Targeted Character Mentions and Mixed Sensory Whisper Engine. |

#### `app.engine.phase1_pre`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/phase1_pre.py` | Phase 1: Auxiliary Pre-Turn Analyzer & Native RNG/Dice Mechanics Resolver. |

#### `app.engine.phase2_context`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/phase2_context.py` | Phase 2: Context Builder, 4-Zone KV-Cache Prompt Assembly & Long-Term Memory Injection. |

#### `app.engine.phase3_actor`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/phase3_actor.py` | Backward-compatibility shim for Phase 3 Actor & Cognition. |

#### `app.engine.phase3_cognition`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/phase3_cognition.py` | Phase 3: Character Cognition & Hidden Thought Generation. |

#### `app.engine.phase4_clerk`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/phase4_clerk.py` | Backward-compatibility shim for Phase 4 Clerk. |

#### `app.engine.phase4_prose`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/phase4_prose.py` | Phase 4: Narrative Prose Generation & Streaming. |

#### `app.engine.phase5_clerk`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/phase5_clerk.py` | Phase 5: Async Post-Turn Clerk & Character State Engine. |

#### `app.engine.world_clock`

| File | Summary |
| :--- | :--- |
| `backend/app/engine/world_clock.py` | In-world clock helpers: parsing, describing, advancing, and extracting narrative time hints. |

#### `app.main`

| File | Summary |
| :--- | :--- |
| `backend/app/main.py` | FastAPI entrypoint and application orchestrator for CyberCantina. |

#### `app.prompts`

| File | Summary |
| :--- | :--- |
| `backend/app/prompts/__init__.py` | Prompt presets and templating package for CyberCantina. |
| `backend/app/prompts/defaults.py` | Factory default prompt templates, preset definitions, and metadata for CyberCantina. |
| `backend/app/prompts/renderer.py` | Template rendering and validation engine for prompts. |

#### `app.providers`

| File | Summary |
| :--- | :--- |
| `backend/app/providers/__init__.py` | Provider fleet: persistence-independent building blocks (endpoint, resolver, probe, seeder). |
| `backend/app/providers/endpoint.py` | Leaf module (no app imports) holding the resolved-endpoint value object. |
| `backend/app/providers/local_relay.py` | In-memory WebSocket relay hub bridging backend LLM calls to browser-local drivers. |
| `backend/app/providers/models.py` | Model catalog parsing shared by probes and the legacy Ollama status call. |
| `backend/app/providers/openrouter_catalog.py` | Global singleton in-memory cache for OpenRouter model catalog. |
| `backend/app/providers/probe.py` | Provider health probing: bounded, single-flight, cached, SSRF-checked, secret-safe. |
| `backend/app/providers/references.py` | Find (and clear) everything that points at a provider: system roles and per-user overrides. |
| `backend/app/providers/resolver.py` | Resolve a role profile's ``provider_id`` to a callable endpoint, enforcing visibility at call time. |
| `backend/app/providers/seeder.py` | One-way migration: derive providers from the pre-existing actor/clerk/embedding settings. |
| `backend/app/providers/settings_service.py` | Applying admin settings: reference validation, BYOP coupling, revision check, atomic persist. |
| `backend/app/providers/webgpu_catalog.py` | Curated WebGPU (WebLLM) model catalog and context ceilings. |

#### `app.routers`

| File | Summary |
| :--- | :--- |
| `backend/app/routers/__init__.py` | FastAPI APIRouter modules for CyberCantina. |
| `backend/app/routers/auth.py` | Authentication, passkeys, user profiles, and admin user management router. |
| `backend/app/routers/campaigns.py` | Campaign Management, Turn Streaming & Spatial State API Router. |
| `backend/app/routers/characters.py` | Characters, versioning, SillyTavern importer, and character media router. |
| `backend/app/routers/enrich.py` | Router for the AI Magic Wand text enrichment service. |
| `backend/app/routers/import_export.py` | FastAPI router for native CyberCantina archive (.zcc) export, auto-detect inspect, and commit. |
| `backend/app/routers/local_relay.py` | WebSocket endpoint and status API for the browser-local inference relay. |
| `backend/app/routers/mechanics.py` | Mechanics and dice preview API router. |
| `backend/app/routers/notes.py` | Private user notes router. |
| `backend/app/routers/personas.py` | User personas REST router. |
| `backend/app/routers/prompts.py` | Prompt presets and template customization router. |
| `backend/app/routers/providers.py` | Provider fleet API: tenant-scoped CRUD, probing, and policy enforcement. |
| `backend/app/routers/settings.py` | Health, Ollama status, runtime settings, and user model overrides router. |
| `backend/app/routers/worlds.py` | Worlds and world creation wizard router. |

#### `app.routers.campaign_routes`

| File | Summary |
| :--- | :--- |
| `backend/app/routers/campaign_routes/__init__.py` | Campaign REST & SSE endpoints package. |
| `backend/app/routers/campaign_routes/crud_and_state.py` | Campaign CRUD, branching, character membership, inventory equip, and turn deletion endpoints. |
| `backend/app/routers/campaign_routes/schemas_and_gate.py` | Campaign router instance, request schemas, concurrency turn gate, and monkeypatch resolver. |
| `backend/app/routers/campaign_routes/spatial_routes.py` | Campaign linked-location, edge distance, map layout, and lore endpoints. |
| `backend/app/routers/campaign_routes/turn_streaming.py` | Campaign turn execution pipeline, SSE streaming, and synchronous turn submission. |

#### `app.schemas`

| File | Summary |
| :--- | :--- |
| `backend/app/schemas/__init__.py` | Pydantic v2 data contracts for CyberCantina. |
| `backend/app/schemas/affective.py` | Core Pydantic schemas, enums, and archetype presets for the CARE psychology engine. |
| `backend/app/schemas/auth.py` | Pydantic schemas for Multi-User Authentication, WebAuthn Passkeys, Profile, and Admin. |
| `backend/app/schemas/character.py` | Character, psyche, memory shard, and cognition schemas. |
| `backend/app/schemas/enrich.py` | Pydantic schemas for the AI Magic Wand text enrichment endpoint. |
| `backend/app/schemas/import_export.py` | Schemas for native CyberCantina archive (.zcc) export and import. |
| `backend/app/schemas/mechanics.py` | Schemas for mechanics checks, previews, and dice calculations. |
| `backend/app/schemas/note.py` | Schemas for User Notes. |
| `backend/app/schemas/persona.py` | User persona, knowledge visibility, and dynamic state schemas. |
| `backend/app/schemas/prompt.py` | Schemas for Prompt Presets, Template Customization, and Documentation. |
| `backend/app/schemas/provider.py` | Pydantic schemas and domain records for LLM providers. |
| `backend/app/schemas/turn.py` | Turn pipeline, mechanics/RNG, state snapshot, and campaign tree schemas. |
| `backend/app/schemas/world.py` | World settings, spatial topology graph, and lore schemas. |

#### `app.security`

| File | Summary |
| :--- | :--- |
| `backend/app/security/__init__.py` | Security helpers: secret encryption at rest and outbound URL policy. |
| `backend/app/security/log_sanitize.py` | Log sanitation helpers preventing CR/LF log injection. |
| `backend/app/security/media_path.py` | Safe filesystem path validation and resolution helpers for character media assets. |
| `backend/app/security/secret_box.py` | Encryption at rest for provider credentials (Fernet, auto-generated key file). |
| `backend/app/security/url_policy.py` | Outbound URL normalization and SSRF policy for provider endpoints. |

#### `app.services`

| File | Summary |
| :--- | :--- |
| `backend/app/services/__init__.py` | Application-layer services orchestrating domain workflows (`import_export_service`). |
| `backend/app/services/import_export_service.py` | Service for packaging, inspecting, and ingesting CyberCantina archives (.zcc). |

#### `app.wizards`

| File | Summary |
| :--- | :--- |
| `backend/app/wizards/__init__.py` | AI-driven Character and World Graph Creation Wizards. |
| `backend/app/wizards/character_extractor.py` | Extraction and surgical prose rephrasing for character bio and core persona. |
| `backend/app/wizards/character_wizard.py` | AI Character Generation Wizard & Deterministic Fallbacks. |
| `backend/app/wizards/sillytavern_distiller.py` | Cognitive distillation and world synthesis for SillyTavern character cards. |
| `backend/app/wizards/sillytavern_parser.py` | Parser and normalizer for SillyTavern character cards (V1/V2 JSON and embedded PNGs). |
| `backend/app/wizards/world_wizard.py` | 1.2 World & Spatial Graph Wizard: Generates world rules, connected locations, and lore. |

#### `app.wizards.char_gen`

| File | Summary |
| :--- | :--- |
| `backend/app/wizards/char_gen/__init__.py` | AI Character Creation Wizard (3-Pass Pipeline & Multi-Genre Fallbacks). |
| `backend/app/wizards/char_gen/draft_pipeline.py` | 3-pass AI character draft generation pipeline. |
| `backend/app/wizards/char_gen/genre_profiles.py` | Multi-genre character fallback profiles and sanitization helpers. |
| `backend/app/wizards/char_gen/inference.py` | Deterministic demographic, moral/quirk, dialogue anchor, and offline fallback inference. |

### Frontend (`frontend/src/`)

#### `App`

| File |
| :--- |
| `frontend/src/App.tsx` |

#### `api`

| File |
| :--- |
| `frontend/src/api/auth.ts` |
| `frontend/src/api/campaigns.ts` |
| `frontend/src/api/characters.ts` |
| `frontend/src/api/client.ts` |
| `frontend/src/api/importExport.ts` |
| `frontend/src/api/index.ts` |
| `frontend/src/api/notes.ts` |
| `frontend/src/api/personas.ts` |
| `frontend/src/api/prompts.ts` |
| `frontend/src/api/providers.ts` |
| `frontend/src/api/settings.ts` |
| `frontend/src/api/stream.ts` |
| `frontend/src/api/worlds.ts` |

#### `components (root)`

| File |
| :--- |
| `frontend/src/components/AppModals.tsx` |
| `frontend/src/components/AppSidebar.tsx` |
| `frontend/src/components/AuthModals.tsx` |
| `frontend/src/components/CharacterMentionPicker.tsx` |
| `frontend/src/components/ChatStage.tsx` |
| `frontend/src/components/CommaSeparatedInput.tsx` |
| `frontend/src/components/DeleteConfirmationModal.tsx` |
| `frontend/src/components/EntityEditorModals.tsx` |
| `frontend/src/components/ExportBundleModal.tsx` |
| `frontend/src/components/HomeEntityPickerModal.tsx` |
| `frontend/src/components/HomeScreen.tsx` |
| `frontend/src/components/ImportPreviewModal.tsx` |
| `frontend/src/components/LiveInspector.tsx` |
| `frontend/src/components/MagicWandButton.tsx` |
| `frontend/src/components/NewCampaignModal.tsx` |
| `frontend/src/components/NotesDrawer.tsx` |
| `frontend/src/components/PersonaEditorModal.tsx` |
| `frontend/src/components/PromptPresetsManager.tsx` |
| `frontend/src/components/SettingsModal.tsx` |
| `frontend/src/components/SidebarCategory.tsx` |
| `frontend/src/components/SpatialTopologyView.tsx` |
| `frontend/src/components/TagChipsInput.tsx` |
| `frontend/src/components/WizardModals.tsx` |

#### `components/auth`

| File |
| :--- |
| `frontend/src/components/auth/AdminModal.tsx` |
| `frontend/src/components/auth/AdminModelsTab.tsx` |
| `frontend/src/components/auth/AdminUsersTab.tsx` |
| `frontend/src/components/auth/AuthScreen.tsx` |
| `frontend/src/components/auth/FeedbackModal.tsx` |
| `frontend/src/components/auth/InitialSetupScreen.tsx` |
| `frontend/src/components/auth/ProfileAccountTab.tsx` |
| `frontend/src/components/auth/ProfileModal.tsx` |
| `frontend/src/components/auth/ProfilePreferencesTab.tsx` |

#### `components/character`

| File |
| :--- |
| `frontend/src/components/character/CharacterAppearanceTab.tsx` |
| `frontend/src/components/character/CharacterBaseTab.tsx` |
| `frontend/src/components/character/CharacterInspectorModal.tsx` |
| `frontend/src/components/character/CharacterInventoryTab.tsx` |
| `frontend/src/components/character/CharacterMediaTab.tsx` |
| `frontend/src/components/character/CharacterMemoriesTab.tsx` |
| `frontend/src/components/character/CharacterPersonalityTab.tsx` |
| `frontend/src/components/character/CharacterVoiceTab.tsx` |
| `frontend/src/components/character/characterMediaUtils.ts` |
| `frontend/src/components/character/index.ts` |

#### `components/chat`

| File |
| :--- |
| `frontend/src/components/chat/ChatComposer.tsx` |
| `frontend/src/components/chat/DirectorChoicesDrawer.tsx` |
| `frontend/src/components/chat/LiveStreamingTurnCard.tsx` |
| `frontend/src/components/chat/TurnCard.tsx` |
| `frontend/src/components/chat/chatHelpers.tsx` |

#### `components/inspector`

| File |
| :--- |
| `frontend/src/components/inspector/AgentChangesModal.tsx` |
| `frontend/src/components/inspector/CampaignCharacterModal.tsx` |
| `frontend/src/components/inspector/CharacterRow.tsx` |
| `frontend/src/components/inspector/InspectorInternalsSection.tsx` |
| `frontend/src/components/inspector/InspectorLocationCard.tsx` |
| `frontend/src/components/inspector/InspectorPrimitives.tsx` |
| `frontend/src/components/inspector/LoreIndexModal.tsx` |
| `frontend/src/components/inspector/campaignCharacter/CampaignCharacterInventoryTab.tsx` |
| `frontend/src/components/inspector/campaignCharacter/CampaignCharacterMediaTab.tsx` |
| `frontend/src/components/inspector/campaignCharacter/CampaignCharacterMemoriesTab.tsx` |
| `frontend/src/components/inspector/campaignCharacter/CampaignCharacterStateTab.tsx` |

#### `components/map`

| File |
| :--- |
| `frontend/src/components/map/MapDetailsDrawer.tsx` |
| `frontend/src/components/map/MapDialogs.tsx` |
| `frontend/src/components/map/MapLoreSection.tsx` |
| `frontend/src/components/map/MapPaletteBar.tsx` |
| `frontend/src/components/map/PortalPromotionModal.tsx` |
| `frontend/src/components/map/SpatialTopologyCanvas.tsx` |
| `frontend/src/components/map/TopologyHeaderToolbar.tsx` |
| `frontend/src/components/map/mapIcons.ts` |
| `frontend/src/components/map/mapValidation.ts` |
| `frontend/src/components/map/topologyProjection.ts` |
| `frontend/src/components/map/useTopologyMutations.ts` |
| `frontend/src/components/map/useTopologyPointerDrag.ts` |

#### `components/models`

| File |
| :--- |
| `frontend/src/components/models/DisclosureSection.tsx` |
| `frontend/src/components/models/IntegerField.tsx` |
| `frontend/src/components/models/ModelCard.tsx` |
| `frontend/src/components/models/ModelDeck.tsx` |
| `frontend/src/components/models/ModelPicker.tsx` |
| `frontend/src/components/models/ModelRoleEditor.tsx` |
| `frontend/src/components/models/NumericSliderField.tsx` |
| `frontend/src/components/models/ThemedPickerDropdown.tsx` |
| `frontend/src/components/models/modelFormatting.ts` |
| `frontend/src/components/models/modelLimits.ts` |
| `frontend/src/components/models/modelPickerLogic.ts` |
| `frontend/src/components/models/sliderMath.ts` |

#### `components/prompts`

| File |
| :--- |
| `frontend/src/components/prompts/PromptRoleCard.tsx` |
| `frontend/src/components/prompts/PromptRoleDeck.tsx` |
| `frontend/src/components/prompts/promptRoleDefinitions.ts` |

#### `components/providers`

| File |
| :--- |
| `frontend/src/components/providers/ProviderBadges.tsx` |
| `frontend/src/components/providers/ProviderCard.tsx` |
| `frontend/src/components/providers/ProviderEditor.tsx` |
| `frontend/src/components/providers/ProvidersContext.tsx` |
| `frontend/src/components/providers/ProvidersManager.tsx` |

#### `components/shared`

| File |
| :--- |
| `frontend/src/components/shared/ClickToEditField.tsx` |

#### `components/wizard`

| File |
| :--- |
| `frontend/src/components/wizard/WorldWizardModal.tsx` |
| `frontend/src/components/wizard/genreFallbacks.ts` |

#### `components/world`

| File |
| :--- |
| `frontend/src/components/world/WorldInspectorModal.tsx` |
| `frontend/src/components/world/worldDraftMappers.ts` |

#### `hooks`

| File |
| :--- |
| `frontend/src/hooks/useCampaignTurnActions.ts` |
| `frontend/src/hooks/useMagicWand.ts` |

#### `local`

| File |
| :--- |
| `frontend/src/local/ollamaDriver.ts` |
| `frontend/src/local/types.ts` |
| `frontend/src/local/webgpu.worker.ts` |
| `frontend/src/local/webgpuCatalog.ts` |
| `frontend/src/local/webgpuDriver.ts` |

#### `main`

| File |
| :--- |
| `frontend/src/main.tsx` |

#### `providers`

| File |
| :--- |
| `frontend/src/providers/LocalRelayContext.tsx` |

#### `types`

| File |
| :--- |
| `frontend/src/types/affective.ts` |
| `frontend/src/types/auth.ts` |
| `frontend/src/types/character.ts` |
| `frontend/src/types/importExport.ts` |
| `frontend/src/types/index.ts` |
| `frontend/src/types/mechanics.ts` |
| `frontend/src/types/notes.ts` |
| `frontend/src/types/persona.ts` |
| `frontend/src/types/prompts.ts` |
| `frontend/src/types/providers.ts` |
| `frontend/src/types/turn.ts` |
| `frontend/src/types/world.ts` |

#### `utils`

| File |
| :--- |
| `frontend/src/utils/choiceCommand.ts` |
| `frontend/src/utils/entityImages.ts` |
| `frontend/src/utils/importExportLogic.ts` |
| `frontend/src/utils/mentions.ts` |
| `frontend/src/utils/narratorCognition.ts` |
| `frontend/src/utils/noteSearch.ts` |
