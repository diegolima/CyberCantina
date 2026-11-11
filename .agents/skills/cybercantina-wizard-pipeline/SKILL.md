---
name: cybercantina-wizard-pipeline
description: >-
  Use this skill when modifying CyberCantina AI creation or import wizards,
  default character/world prompt templates, Pydantic wizard schemas, SillyTavern
  distillers, bio/demeanor extractors, or debugging generated character/world drafts.
---

# CyberCantina Wizard & Schema Maintenance Runbook

## Architecture Map
- **Routers**: `backend/app/routers/characters.py`, `backend/app/routers/worlds.py`
- **3-Pass Character Generator**: `backend/app/wizards/character_wizard.py`
- **Extractors & Importers**: `backend/app/wizards/character_extractor.py`, `backend/app/wizards/sillytavern_distiller.py`
- **Schemas & Sanitizers**: `backend/app/schemas/character.py`, `backend/app/schemas/affective.py`, `backend/app/schemas/world.py`
- **Prompt Defaults**: `backend/app/prompts/defaults.py`
- **Wizard Modal UI & Client Fallbacks**: `frontend/src/components/WizardModals.tsx`

## Character Generation 3-Pass Contract
1. **Pass 1 (`CharacterWizardPass1LLMOutput`) — Identity, Anatomy & Gear**:
   - Generates demographics (`species`, `sex`, `pronouns`, `age`), `build_and_height` (metric height ONLY, e.g. `"178 cm"` — morphology belongs in `distinctive_features`), `character_bio`, `tagline`, 6 immutable `distinctive_features` (no attire/items; include 1 quirky detail), `posture`, 4 unprefixed `mannerisms`, `visual_aesthetic`, and single-object `equipped`/`inventory` items.
2. **Pass 2 (`CharacterWizardPass2LLMOutput`) — Mind, Ethics, Voice & Memories**:
   - Conditioned on Pass 1 identity + bio + creator notes (`rough_notes`) to prevent generic hero-code contradictions.
   - Outputs concise `core_persona` (45–75 words), aligned `moral_code`, `quirks_flaws`, `communication_style`, literary author-grounded `voice_anchors`, `core_drive`, `core_fear`, `default_want`, `default_plan` (`list[str]`, 2–3 steps), concrete episodic `memory_shards` (Who/What/Where/Consequence — forbid vague atmospheric poetry so RAG/GraphRAG retrieval hits), and starting mood.
   - Post-process deterministically: `normalize_starting_mood` snaps mood strings + coordinates to the 7 `BASELINE_MOOD_PRESETS`; `infer_temperament_and_worldview_from_text` assigns CARE archetype without LLM drift; `normalize_bullet_plan` emits `- step\n- step` lines.
3. **Pass 3 (`CharacterWizardPass3LLMOutput`) — Turn 0 Opening Greeting**:
   - Receives finalized Pass 1 + Pass 2 outputs plus `rough_notes`, `role_in_story`, `inventory`, `memory_shards`, `default_want`, and starting location context.
   - Emits a focused 3-beat `initial_message`: environment/immediate stakes -> quick visual snapshot + tell -> intent-driven first line.

## Schema Sanitizers & Item Rules
- **Markup Hygiene (`sanitize_character_markup`)**:
  - Run automatically in `CharacterWizardDraft._sanitize_and_sync_fields` and shared with `character_extractor.py` and `sillytavern_distiller.py`.
  - Prose mode (`preserve_italics=True`, used on `initial_message` and `voice_anchors[].snippet`): strips `<think>`/`<thought>`/`<reasoning>`/`<scratchpad>` & `<!-- -->`, converts `<p>`/`<br>`/`<li>` structure, converts `<i>`/`<em>` into paragraph-safe Markdown `*...*` for `renderFormattedProse`, strips remaining HTML/XML tags, and unescapes HTML entities.
  - Plain-text/chip mode (`preserve_italics=False`, optional `single_line=True`): strips all HTML/XML tags without adding `*` markers and unescapes entities.
- **Single-Item Gear & Genre Fallbacks**:
  - `_split_compound_items` splits `"X and Y"` compounds into discrete `ItemInstance` entries; `resolve_genre_fallback_profile` covers all 13 genre profiles (keep backend `character_wizard.py` and frontend `WizardModals.tsx` genre profiles synchronized).
- **Height Sanitization**:
  - `_sanitize_height_only` strips appended frame/build descriptors from `build_and_height`; `phase2_context.py` renders `- Height:` when build is absent and `- Build & Height:` for legacy rows.

## Debugging & Verification Workflow
1. **Inspect Live Saved Characters** (when auditing a reported generation defect):
   ```bash
   python3 -c "import sqlite3, json; conn = sqlite3.connect('backend/cybercantina.db'); conn.row_factory = sqlite3.Row; row = conn.execute('SELECT * FROM characters ORDER BY created_at DESC LIMIT 1').fetchone(); print(json.dumps(dict(row), indent=2) if row else 'none')"
   ```
   Check whether fields were omitted by the LLM, replaced by defaults (e.g., identical fallback strings), truncated, or emitted with raw HTML/inline bullets.
2. **Verify All Changes**:
   ```bash
   backend/.venv/bin/pytest backend/tests/test_character_attributes_and_versions.py
   backend/.venv/bin/pytest backend/tests
   npm --prefix frontend run build && npm --prefix frontend test
   ```
