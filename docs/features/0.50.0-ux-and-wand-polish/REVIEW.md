---
feature: ux-and-wand-polish
target_version: 0.50.0
document_type: review
status: completed
last_updated: 2026-11-27
---

# Pre-Implementation Review — Home Mobile Header, Map Stay-Open Save & Magic Wand Prompt Polish

## Key Architectural Traps & Mitigations

### 1. Silent CoW World Versioning & `new_*` ID Reconciliation on Stay-Open Save
- **Trap:** In `AppModals.tsx`, `WorldInspectorModal` calls `api.updateWorld(activeWorldId, ...)`. When a world is already referenced by a campaign, the backend performs silent Copy-on-Write (CoW) versioning and returns a **new `updated.id`**, as well as server-assigned canonical IDs for any newly created `new_cont_*`, `new_loc_*`, `new_edge_*`, or `new_lore_*` records. If stay-open `onSaved(updated, false)` only clears `isDirty` without syncing `activeWorldId` and canonical IDs—or conversely, if `AppModals` changes `key={world.id}` and remounts `WorldInspectorModal`—either a second save will fail/duplicate nodes or the user will lose their active tab, pan/zoom, drilled container, and selection.
- **Mitigation:**
  - Keep `WorldInspectorModal` mounted without keying it on `world.id` in `AppModals.tsx`.
  - On stay-open save in `WorldInspectorModal.handleSave()`, update `activeWorldId` to `updated.id`, replace `containers`, `locations`, `edges`, and `loreNodes` from `updated`, and reset `isDirty = false`.
  - In `SpatialTopologyView`, ensure prop updates when `!internalDirty` sync `draft` cleanly without resetting `pan`, `zoom`, or `currentContainerId`, and remap `selectedLocationId` / `selectedContainerId` if a `new_*` node receives a server ID (or preserve selection by matching `(name, container_id, x, y)` fallback when IDs change).

### 2. `Save & Close` Error-Abort Invariant & Dual-Dirty State in Campaign `WorldInspectorModal`
- **Trap:** In `WorldInspectorModal.tsx`, `handleSave()` validates Codex entries across tabs (potentially switching `activeTab` to `"codex"` and setting `error`) and returns `void`. If `Save & Close` naively calls `await handleSave(); requestClose();`, a validation failure or network error would still close the modal and lose user edits! Additionally, inside campaign `WorldInspectorModal`, `Save Map` persists only the map (`onSaveCampaignMap`) while World Settings (`describe_on_first_visit`, `unlock_lore`) or GM World Codex edits may still be unsaved (`isDirty || campaignWorldLoreDirty`).
- **Mitigation:**
  - Refactor `WorldInspectorModal.handleSave()` to return `Promise<boolean>` (`true` only on complete API success, `false` on validation or API error).
  - Refactor `SpatialTopologyView.handleSaveClick()` to return `Promise<boolean>` (`true` only when `onSaveMap` resolves cleanly).
  - Have `Save & Close` await the save boolean and invoke `onClose` / `requestClose` **strictly** when `true`. In `WorldInspectorModal` campaign mode, pass `requestClose` as the map close target so unsaved World Settings or Codex changes still trigger `NavigationGuardModal` instead of silently discarding them.

### 3. Split-Button Dropdown Stacking, `Escape` Key Leakage & Mobile Touch Targets
- **Trap:** `WorldInspectorModal` uses `useModalDialog`, where `Escape` triggers `requestClose()`. If a user opens the `Save ▾` dropdown menu and presses `Escape`, a document-level modal listener will close the entire modal if the menu doesn't intercept `Escape` first. Also, `.map-toolbar-actions` in `TopologyHeaderToolbar.tsx` is already tight on `<= 820px`; a tiny chevron button next to `Save Map` and `X` risks mis-taps.
- **Mitigation:**
  - Implement a shared, Node-SSR-safe `SplitSaveButton` (or cohesive split-button group) with `e.stopPropagation()` on `Escape` when the dropdown is open, outside-pointer dismissal inside `useEffect`, and `aria-haspopup="menu"` / `aria-expanded`.
  - Give the chevron segment a minimum `32px` width/height touch target (`36px` on `<= 820px`) with a clear divider border separating primary `Save` from the `▾` menu trigger.
  - Omit the `▾` segment whenever `onSaveAndClose` / close handler is absent so there is never an inert dropdown.

### 4. Reasoning Model `<think>` Truncation Under Low `max_words` Caps
- **Trap:** In `backend/app/routers/enrich.py`, `max_tokens=min(req.max_words * 4, 300)` was written assuming direct prose output. For `location_summary` (`max_words=20`) or `location_description` (`max_words=55`), `20 * 4 = 80` tokens. Reasoning/thinking models that emit `<think>...</think>` reasoning before the answer will exhaust `80` tokens inside `<think>`, leaving `_strip_thought_blocks_linear` with an empty string `""`.
- **Mitigation:**
  - Decouple completion `max_tokens` from tight prose word caps using a safe floor (`max_tokens = max(req.max_words * 4, 320)`, or `min(max(req.max_words * 4, 320), 600)`), while enforcing sentence/word brevity in the prompt and deterministic single-paragraph / quote-stripping post-processing.

### 5. Multi-Character & Solo-Room Co-Presence Resolution in `player_turn_prompt`
- **Trap:** `enrich.py` currently reads `campaign.character_id` unconditionally for `campaign_turn`, ignoring multi-character scenes (party/co-located NPCs) and solo rooms (where `campaign.character_id` stayed elsewhere). Also, `override_location_id` may move the player's target context to an adjacent room where different characters (or zero characters) are present.
- **Mitigation:**
  - Inspect `leaf_turn.world_snapshot` (`character_locations` / turn states via `repo.get_character_turn_states` or `repo` helpers—verify exact repository API during implementation) to collect all campaign characters currently located at `target_loc_id` (`override_location_id or leaf_turn.world_snapshot.active_location_id`).
  - Format `Present NPCs` as the exact co-present list (or `"None (player is alone at this location)"` when empty) and instruct the model to address only present characters (or focus solely on the player's action/observation when alone).
  - Never expose `str(exc)` in HTTP responses (`py/stack-trace-exposure`) and sanitize logged strings with `sanitize_log_value` (`py/log-injection`).

### 6. `MapLoreSection` Dual Modes & `CodexLocationDetail` / `WorldCodexTab` Context Wiring
- **Trap:** `MapLoreSection.tsx` has two distinct edit paths: (a) editor-mode expandable accordion rows (`loreList.map`) and (b) campaign GM-mode inline form (`campLoreTitle` / `campLoreContent` / `campLoreTags`). Furthermore, `CodexLocationDetail.tsx` renders `MapLoreSection` in campaign GM mode (`WorldCodexTab` -> `CodexLocationDetail`), where `worldContext` (`worldName`, `genre`, `tone`, `settingOverview`) is not currently passed down, and `WorldCodexTab.tsx` currently edits world lore in its own panel.
- **Mitigation:**
  - Thread an optional `worldContext?: WorldPromptContext` prop cleanly from `WorldInspectorModal` -> `WorldCodexTab` -> `CodexLocationDetail` -> `MapLoreSection`, and from `MapDetailsDrawer` -> `MapLoreSection` (for both location and depth-1 container panels).
  - Add compact `MagicWandButton` instances to both `MapLoreSection` edit paths (expanded draft row and campaign GM form) and to `WorldCodexTab`'s editable world-lore content textarea, keyed cleanly per entity/lore ID so switching entries aborts/resets any in-flight wand request (`contextKey`).
  - Keep `useMagicWand` calls strictly inside subcomponents or keyed wrappers so React Hook Rules (no conditional hook calls inside `.map()` loops) are never violated—extract a small `LoreContentFieldWithWand` subcomponent for list items.

### 7. Frontend Layer Boundaries, CSS Audit & Node-Only Vitest SSR Safety
- **Trap:** `frontend/package.json` runs Vitest in Node without `jsdom`, `npm run arch:check` enforces `.dependency-cruiser.cjs` layer boundaries, and `npm run css:audit` rejects `!important` and unmodular styles.
- **Mitigation:**
  - Place new pure helpers/types in `frontend/src/types/` and component-local helpers; keep all `document`/`window` listeners inside `useEffect`.
  - Keep Home navbar CSS in `10-home.css` / `15-responsive.css` and split-button styles in `02-primitives.css` / `09-spatial-topology.css` without `!important`.
  - Update `ReactDOMServer.renderToStaticMarkup` tests for `HomeScreen`, `TopologyHeaderToolbar`, `WorldInspectorModal`, `MapDetailsDrawer`, `MapLoreSection`, and `WorldCodexTab`.
