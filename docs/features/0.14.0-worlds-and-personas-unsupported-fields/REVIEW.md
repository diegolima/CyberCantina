# CyberCantina v0.14.0 Pre-Implementation & Architecture Review

## Scope Reviewed
Review of [`FRD.md`](./FRD.md) applying the `unsupported_fields` compatibility lifecycle to **Personas** and **Worlds** while extracting shared backend/frontend primitives.

---

## Key Architectural Risks & Resolutions

### 1. Shared Layering Boundaries (`tach` & `dependency-cruiser`)
- **Risk:** Putting shared `unsupported_fields` helpers inside `services/`, `engine/`, or `components/` could trigger circular or upward dependency violations under `backend/tach.toml` (`app.schemas` -> only `app.config`) or `frontend/.dependency-cruiser.cjs` (`src/utils/` -> only `src/types` & `src/utils`).
- **Resolution:**
  - Backend shared bounded validator placed strictly in `backend/app/schemas/unsupported.py` (no upward imports).
  - Frontend pure helpers placed in `frontend/src/utils/unsupportedFields.ts` (leaf-compatible under `src/utils/`), and shared UI component placed in `frontend/src/components/shared/UnsupportedFieldsTab.tsx`.

### 2. World Container Mutations Overwriting `unsupported_fields`
- **Risk:** Internal calls to `self.update_world(...)` in `backend/app/db/repos/world_locations.py` (`delete_location_container`, `convert_location_to_container`) construct `WorldUpdatePayload` from `orig`. If `WorldUpdatePayload.unsupported_fields` defaulted to `{}` instead of `None`, map container edits would silently erase world-level `unsupported_fields`.
- **Resolution:**
  - `WorldUpdatePayload.unsupported_fields` and `PersonaUpdatePayload.unsupported_fields` default to `None`.
  - `update_world` / `update_persona` preserve `orig.unsupported_fields` / `existing.unsupported_fields` whenever the field is `None`.
  - Both `world_locations.py` methods explicitly forward `unsupported_fields=orig.unsupported_fields`.

### 3. `WorldGlobalRules._coerce_rules` Alias Consumption vs. Conflict Retention
- **Risk:** Capturing every alias key (`genre_and_tone`, `mood`, `atmosphere`, etc.) unconditionally under `global_rules.<alias>` would clutter the `Unsupported` tab with already-migrated data when `genre`/`tone` were auto-filled on import or DB read. Conversely, ignoring conflicting non-empty aliases would silently discard user prose.
- **Resolution:**
  - `extract_world_unsupported_fields` mirrors `_coerce_rules`: it skips an alias key only when consumed to fill an empty `genre`/`tone` (or equal in trimmed text), while preserving conflicting non-empty alias values under `"global_rules.<alias>"`.

### 4. Read-Time DB Non-Mutation for Running Campaigns
- **Risk:** Running campaigns rely on frozen snapshots (`campaigns.persona_snapshot_json`) and untouched pre-migration world rows; mutating DB rows during reads or startup migrations would surprise active play.
- **Resolution:**
  - Pre-migration rows (`personas.physical_appearance`, `worlds.global_rules_json` legacy keys) are surfaced dynamically into `unsupported_fields` inside `_row_to_persona_record` and `get_world` without writing back to SQLite until an explicit save/update occurs.
  - `zone1_static.py` continues excluding `unsupported_fields` completely while retaining `persona_snapshot.physical_appearance` fallback solely for frozen snapshots.

### 5. Frontend UX Consistency & Read-Only Campaign Mode
- **Risk:** `WorldInspectorModal` operates in `"inspector"`, `"wizard"`, and `"campaign"` modes. Exposing `Delete` or migration buttons during active campaign inspection (`mode === "campaign"`) could mutate dirty state unexpectedly, and failing to update `api.updateWorld` TypeScript types would drop `unsupported_fields` on save.
- **Resolution:**
  - Added `unsupported_fields` to `WorldRecord` and `api.updateWorld` payload type in `frontend/src/api/worlds.ts`.
  - Enforced `readOnly={isCampaignMode || isMutatingLocked}` on `WorldInspectorModal`'s `UnsupportedFieldsTab` and early-return guards on handlers so `markDirty()` is never called in campaign mode.
  - Added conditional **`Unsupported`** tab only when non-empty, and reset `activeTab` to `"base"` if all unsupported fields are deleted on save.
