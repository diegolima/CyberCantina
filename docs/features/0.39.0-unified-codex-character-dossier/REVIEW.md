---
feature: unified-codex-character-dossier
target_version: 0.39.0
document_type: review
status: completed
last_updated: 2026-11-25
---

# Pre-Implementation Review — v0.39.0 Unified Campaign Character Presentation (Codex Dossier)

## Key Architectural Traps & Mitigations

1. **Module Boundary & Circular Dependency Risk (`components/world` ↔ `components/inspector`):**
   - `LiveInspector.tsx` (root `components/`) imports `buildCampaignCharacterEntries` from `./world/codexHelpers` and `CharacterRow` from `./inspector/CharacterRow`.
   - Meanwhile, the 4 live campaign character subtab components currently live under `frontend/src/components/inspector/campaignCharacter/` (`CampaignCharacterStateTab.tsx`, `CampaignCharacterInventoryTab.tsx`, `CampaignCharacterMemoriesTab.tsx`, `CampaignCharacterMediaTab.tsx`), and `CampaignCharacterMediaTab.tsx` imports `BASIC_EMOTIONS` from `../../EntityEditorModals` (which imports `CharacterInspectorModal` and `WorldInspectorModal`).
   - **Trap:** Importing `CampaignCharacterMediaTab` (via `EntityEditorModals`) into `CodexCharacterDetail` → `WorldCodexTab` → `WorldInspectorModal` would create a **runtime circular dependency** (`WorldInspectorModal` → `WorldCodexTab` → `CodexCharacterDetail` → `CampaignCharacterMediaTab` → `EntityEditorModals` → `WorldInspectorModal`), failing `npm --prefix frontend run arch:check`!
   - **Mitigation:**
     - Move the 4 campaign character tab components into `frontend/src/components/world/codexCharacter/` (or keep them leaf-scoped under `world/`).
     - Import `BASIC_EMOTIONS` directly from `../../character/characterMediaUtils` (pure leaf module) instead of `EntityEditorModals`.

2. **Lifting Character Mutation Handlers & Focus Routing Through `App.tsx` → `WorldInspectorModal`:**
   - Currently, `App.tsx` passes `onToggleItemEquip`, `onUpdateCampaignMemories`, and `onOverrideCharacterLocation` only to `LiveInspector` (which owned `CampaignCharacterModal`), NOT to `WorldInspectorModal`.
   - Additionally, `WorldInspectorModal` is keyed in `App.tsx` as `key={`${bundle.campaign.id}:${campaignWorldSheetTab}`}` and `CodexFocusRequest` currently only supports `{ loreId: string; nonce: number }`.
   - **Mitigation:**
     - Extend `CodexFocusRequest` into a backward-compatible union supporting both lore focus (`{ kind?: "lore"; loreId: string; nonce: number }`) and character focus (`{ kind: "character"; characterId: string; initialSubtab?: CodexCharacterSubtab; nonce: number }`).
     - Lift `handleOpenCharacterInCodex(characterId, initialSubtab)` in `App.tsx` to set `campaignWorldSheetTab("codex")` and bump the `CodexFocusRequest` nonce so clicking a right-pane character card works whether the Codex modal was previously closed or already open.
     - Pass `onToggleItemEquip`, `onUpdateCampaignMemories`, `onOverrideCharacterLocation`, `activeParties`, `activePersonaTurnState`, and `characterNameMap` from `App.tsx` → `WorldInspectorModal` → `WorldCodexTab` → `CodexCharacterDetail`.

3. **Preserving `Knowledge of You` (`unlocked_persona_keys` + Provenance):**
   - Codebase audit confirmed `unlocked_persona_keys` and `persona_knowledge_provenance` were **only** rendered inside `CharacterRow.tsx`'s expanded accordion—not in `CampaignCharacterStateTab.tsx`.
   - **Mitigation:** Migrate the `Knowledge of You` section (including persona secret label resolution for age/items/lore and Direct vs. Gossip provenance badges) directly into `CampaignCharacterStateTab` (rendered in the `Current` tab alongside Dyadic Relational Bonds), passing `personaSnapshot` through `CodexCharacterDetail`.

4. **Split-Pane Width & 8-Tab Ergonomics Inside `WorldCodexTab`:**
   - `CodexCharacterDetail` lives inside `.codex-detail-pane` (right side of a 2-column split inside `WorldInspectorModal`), which is narrower than `CampaignCharacterModal`'s `modal-panel--sheet`.
   - **Mitigation:**
     - Place the compact Identity Header **above** the subtab bar so tabs clearly scope to the character and don't collide with `WorldInspectorModal`'s top tab bar.
     - Style `.codex-char-tabs` with compact padding, `flex-wrap: wrap` (or clean horizontal scroll on narrow screens), subtle visual distinction on Live/Engine tabs (`Memories`, `Inv`, `Current`), and responsive 2-column → 1-column collapse on `Pers` (`Moral Code & Boundaries` / `Quirks & Flaws`) and `Current` meters below `820px`.

5. **Artifact Lore Cross-Link Jump Inside `Inv` Tab:**
   - In the old `CodexCharacterDetail`, equipped artifacts had a `Sparkles` jump button (`onJumpToLore(linkedLore.id)`). `CampaignCharacterInventoryTab` currently shows artifact badges and lets users link/unlink `lore_id`, but didn't have a Codex jump button because it lived in a separate modal.
   - **Mitigation:** Pass optional `onJumpToLore?: (loreId: string) => void` into `CampaignCharacterInventoryTab` so linked artifacts inside the `Inv` tab can jump directly to their Codex `Items & Artifacts` entry in one click.

6. **CSS Audit Hygiene (`npm --prefix frontend run css:audit`) & Test Suite Updates:**
   - Retiring `CampaignCharacterModal` and the `CharacterRow` accordion body will leave unused `.char-row-*` classes if not pruned from `frontend/src/styles/06-inspector-and-lore.css`.
   - Existing tests (`tabbedSheetModals.test.tsx`, `partyUi.test.tsx`, `worldCodex.test.tsx`, `videoAndGovernance.test.tsx`, `personaParity.test.tsx`) reference `CampaignCharacterModal`, `CharacterRow` expanded markup, or the old `CodexCharacterDetail` structure.
   - **Mitigation:** Audit and clean unused CSS selectors in `06-inspector-and-lore.css`, add new Codex character dossier styles in `12-world-codex.css` (and responsive rules in `15-responsive.css`), and update/expand Vitest SSR + unit tests to cover the unified flow.
