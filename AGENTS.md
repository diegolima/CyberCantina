# CyberCantina Agent Guidelines

## Architecture & Context Discipline
- **4-Zone KV-Cache Economy**: Zone 1 static system context (`backend/app/engine/phase2_context.py`) is paid on every turn. Keep injected character fields non-redundant and concise (strict domain boundaries between `core_persona`, `moral_code`, `quirks_flaws`, `communication_style`, `distinctive_features`, and `equipped`/`inventory`).
- **End-to-End Field Synchronization**: When changing a generated entity field's semantics or constraints (e.g., `"Height"` metric-only, single-item equipment), update all layers together: frontend form components & manual/offline fallbacks, backend prompt templates (`backend/app/prompts/defaults.py`), Pydantic schema `Field(description=...)`, backend fallback generators, and Zone 1 prompt rendering.

## LLM Integration & Post-Processing
- **Constrained JSON Schemas (Pydantic v2)**: Models with default field values emit `required: []` JSON Schemas, letting local 12B Ollama/llama.cpp models omit keys or emit blanks. Pass explicit `required_properties=list(schema_cls.model_fields.keys())` to `complete_structured` (`backend/app/engine/llm_client.py`) and model multi-line bullet outputs as `list[str]` arrays in LLM pass schemas rather than newline-delimited strings.
- **Never Shadow Multi-Pass Pipelines**: Do not pass an always-populated default prompt key (e.g., from `resolve_effective_prompts`) as an override flag into multi-pass wizard functions; doing so silently routes requests into legacy single-pass fallbacks.
- **Deterministic Hygiene Over Negative Prompts**: Do not spend prompt tokens forbidding HTML tags or formatting quirks ("never emit `<i>`"); sanitize deterministically in centralized Pydantic schema `@model_validator`s instead. Preserve functional prose formatting (e.g., convert `<i>`/`<em>` to Markdown `*...*` matching `renderFormattedProse` in `frontend/src/components/ChatStage.tsx`) while stripping raw markup from plain-text/chip fields and dropping chain-of-thought wrapper blocks (`<think>`, `<thought>`, `<reasoning>`, `<scratchpad>`). Match strict HTML tag patterns (`</?[a-zA-Z]...`) rather than greedy `<[^>]+>` so comparison operators (`Age < 30`) remain intact.
- **Genre-Adaptive Fallbacks**: Never hardcode single-genre (e.g., cyberpunk) defaults or few-shot examples in shared fallbacks; resolve defaults from multi-genre profiles and assign structured enums/presets (e.g., `BASELINE_MOOD_PRESETS`, CARE temperament) deterministically.

## Frontend UI & UX Contracts
- **Tag & Keyword Inputs**: Always use `TagChipsInput` (`frontend/src/components/TagChipsInput.tsx`) for tag/keyword arrays. Never bind `<input value={tags.join(", ")}>` with `.split(",").filter(Boolean)` in `onChange`, which deletes spaces and trailing commas on every keystroke.
- **Semantic Accents**: Reserve `--accent-rose` / red strictly for errors, validation failures, and destructive actions. Assistive AI extract/populate actions must use `--accent-amber` or `--accent-violet` with `Sparkles`.
- **Dynamic Node Modals & Creation Flows**: Keep primary `+ Add` headers sticky inside long node editors and scroll/focus newly appended entries into view. Separate catalog saving (`Save Character`) from optional session launch toggles (`Immediately start a campaign`).

## Verification & Debugging
- **Live Output Diagnostics**: When debugging user-reported generation issues, inspect saved rows directly in `backend/cybercantina.db` via `sqlite3` to verify whether defects stem from LLM output, fallback imputation, or frontend rendering.
- **Required Checks Before Completion**:
  - Backend: `backend/.venv/bin/pytest backend/tests`
  - Frontend: `npm --prefix frontend run build && npm --prefix frontend test`
