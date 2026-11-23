---
feature: gm-codex-authoring-and-tools
target_version: 0.33.0
document_type: review
status: approved
last_updated: 2026-11-23
---

# Pre-Implementation Review — v0.33.0 GM-Assisted World Codex Authoring (Phase 1)

## Key Architectural Traps & Mitigations

1. **Pydantic v2 JSON Grammar (`required_properties`) for Local 12B Models:**
   - Models with default values on Pydantic v2 fields emit `required: []` JSON Schemas, letting constrained decoders on 7B–12B Ollama/`llama.cpp` models skip keys or emit empty strings.
   - `draft_world_codex_proposal` must pass `required_properties=list(GmWorldLoreDraftLLMOutput.model_fields.keys())` to `llm_client.complete_structured` and model `entity_tags` strictly as `list[str]` rather than a comma-separated string.

2. **Deterministic Hygiene Without ReDoS or OOC Leakage:**
   - `DEFAULT_GM_TALK_SYSTEM` instructs Neuromancer to cite turn numbers in OOC replies (e.g., `Sources: Turns 12–14`), which must never leak into persisted `LoreNode.content` (injected into in-character prompts via `lore_scope.py`).
   - `GmWorldLoreDraftLLMOutput` runs a deterministic `@model_validator(mode="before")` using linear `.find()` loops to strip `<think>`/`<thought>`/`<reasoning>`/`<scratchpad>` wrapper blocks and trailing `Sources:` / `Source:` turn-citation lines, keeping comparison operators (`Age < 30`) intact and avoiding polynomial regexes (`py/polynomial-redos`).

3. **Exploratory Questions vs. Explicit Add-to-Codex Commands:**
   - Questions like *"What would be a reasonable entry to add to the codex?"* ask for a brainstorm in prose—they must **not** trigger silent mutation or false intent routing.
   - `detect_explicit_codex_add_intent` uses explicit imperative/command checks while rejecting exploratory `"what would..."` / `"should i..."` questions, and even when triggered, it emits a non-destructive `GmCodexProposal` card requiring deterministic user confirmation.

4. **Permission & Spoiler Boundaries (`unlock_lore`):**
   - `POST /api/campaigns/{campaign_id}/lore/entries` allows the campaign owner to append **new** campaign-scoped World Codex entries (`WorldLoreCategory`, never `secret`) and update campaign-authored entries even when `unlock_lore === false`, without requiring GM Mode.
   - Overwriting a pre-existing **base-world** authored Codex entry (`existing.campaign_id is None or existing.origin_lore_id is not None`) requires `unlock_lore === true` (GM Mode), returning `403` otherwise.
   - Draft extraction context strictly enforces GM Talk's `unlock_lore` filter so hidden `secret` lore, unvisited locations/containers, and private `<cognition>` are never leaked into proposals.

5. **Branch-Safe Single-Entry CoW Append & `.zcc` v2 Continuity:**
   - Confirming a proposal calls `aupsert_campaign_world_lore_entry`, which avoids full-list client overwrite races by resolving active-branch world lore server-side, appending/updating atomically, pre-computing embeddings asynchronously, and writing branch-safe Copy-on-Write rows (`created_at_turn_id`, `campaign_lore_tombstones`, `vector_entries`).
   - `gm_chat_messages.proposals_json` persists proposal status (`pending` / `confirmed` / `cancelled`), `saved_lore_id`, and `duplicate_matches` across page reloads and branch checkouts, and round-trips cleanly in `.zcc` v2 exports when `include_gm_chat=True`.

6. **Layer Boundaries, Facade Parity & Frontend Constraints:**
   - Keep `backend/app/schemas/gm.py` cycle-free by placing `CampaignWorldLoreEntryUpsertRequest` and `CampaignWorldLoreEntryUpsertResponse` (which depend on `CampaignStateBundle`) in `backend/app/routers/campaign_routes/schemas_and_gate.py`.
   - Declare `app.engine.gm_codex` in `backend/tach.toml` and re-export new route callables from `backend/app/routers/campaigns.py`.
   - Use `TagChipsInput` for `entity_tags` editing, reserve `--accent-rose` strictly for errors, keep all new `GmTalkDrawerProps` optional for test compatibility, update `AppSidebar` `codexCount` to reflect `bundle.world_lore_nodes`, and place CSS in `05-composer-and-slash.css` + `15-responsive.css` (`css:audit`, `arch:check`).
