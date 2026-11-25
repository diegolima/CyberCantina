---
feature: unified-codex-character-dossier
target_version: 0.39.0
document_type: plan
status: completed
last_updated: 2026-11-25
---

# Implementation Plan — v0.39.0 Unified Campaign Character Presentation (Codex Dossier)

## Stage 0: Feature Package Lifecycle Artifacts
- [x] Author `FRD.md`
- [x] Author `REVIEW.md`
- [x] Author `PLAN.md`

## Stage 1: Relocate & Enhance Live Campaign Character Tab Components
- [x] Move the 4 campaign character tab components out of `frontend/src/components/inspector/campaignCharacter/` into `frontend/src/components/world/codexCharacter/` to keep `world/` free of upward/circular imports:
  - [x] `CampaignCharacterStateTab.tsx`: add `personaSnapshot?: PersonaRecord | null` prop and render the migrated **Knowledge of You** card (`unlocked_persona_keys` + Direct/Gossip provenance) alongside Dyadic Relational Bonds.
  - [x] `CampaignCharacterInventoryTab.tsx`: add optional `onJumpToLore?: (loreId: string) => void` prop so linked Artifact items can jump directly to their Codex lore entry.
  - [x] `CampaignCharacterMemoriesTab.tsx`: preserve campaign-scoped shard editing + count callback.
  - [x] `CampaignCharacterMediaTab.tsx`: import `BASIC_EMOTIONS` directly from `../../character/characterMediaUtils` (breaking the `EntityEditorModals` cycle risk).
- [x] Update `CodexCampaignCharacterEntry` in `frontend/src/components/world/codexHelpers.ts` to include optional `partyRole?: "player_party" | "npc_leader" | "npc_party" | null` and `partyName?: string | null` (populated in `buildCampaignCharacterEntries` when `activeParties` is provided).

## Stage 2: Expand `CodexCharacterDetail` into the Unified Tabbed Dossier
- [x] Redesign `frontend/src/components/world/CodexCharacterDetail.tsx`:
  - [x] Shared **Persistent Identity Header** at the top (Portrait, Name, Tagline, Tags, Status/Demographic/Party/Temperament badges).
  - [x] **NPC Character (`kind="character"`) 8-tab layout** below the header:
    - [x] `Bio`: Character Biography card + conditional `Creator Notes` & `Opening Scene` footer buttons toggling an inline drawer card below the bio box.
    - [x] `Appearance`: `Height`, `Resting Posture`, `Visual Aesthetic`, `Distinctive Features` chips, and `Mannerisms & Behavioral Tells` bulleted list.
    - [x] `Pers`: `Core Demeanor` prose box, `Traits` chips, 2-column `Moral Code & Boundaries` & `Quirks & Flaws` bulleted lists, and `Baseline Psyche & Emotional Defaults` (`Core Drive`, `Core Fear`, Temperament preset, baseline mood/PAD).
    - [x] `Voice`: `Communication Style` chips and `Voice Anchors` dialogue snippets.
    - [x] `Memories`: embeds `CampaignCharacterMemoriesTab`.
    - [x] `Inv`: embeds `CampaignCharacterInventoryTab` with `onJumpToLore`.
    - [x] `Current`: embeds `CampaignCharacterStateTab` (with `Knowledge of You` + `Relocate Character`).
    - [x] `Media`: embeds `CampaignCharacterMediaTab` (8 emotion portraits + Photo Album lightbox).
    - [x] Visually distinguish Live/Engine tabs (`Memories`, `Inv`, `Current`) via subtle accent/divider styling.
  - [x] **Player Persona (`kind="persona"`) 5-tab layout** below the matching Identity Header:
    - [x] `Bio`, `Appearance`, `Gear`, `Lore & Secrets`, `Media`.
  - [x] Support `initialSubtab` prop (defaulting to `"bio"` on sidebar/search selection, `"current"` when focused from the right pane) and reset/sync subtab cleanly when `characterEntry.record.id` or `focusNonce` changes.

## Stage 3: Wire Codex Focus & Campaign Mutations Through `App` → `WorldInspectorModal` → `WorldCodexTab`
- [x] Extend `CodexFocusRequest` in `frontend/src/components/world/WorldCodexTab.tsx` to support character focus (`{ kind: "character"; characterId: string; initialSubtab?: CodexCharacterSubtab; nonce: number }`) alongside existing lore focus (`loreId`).
- [x] Pass campaign character mutation props & context (`locations`, `characterNameMap`, `onToggleItemEquip`, `onUpdateCampaignMemories`, `onOverrideCharacterLocation`, `activePersonaTurnState`) through `App.tsx` → `WorldInspectorModal.tsx` → `WorldCodexTab.tsx` → `CodexCharacterDetail.tsx`.
- [x] Add `handleOpenCharacterInCodex(characterId, initialSubtab = "current")` in `App.tsx` and pass it into `LiveInspector`.

## Stage 4: Simplify `CharacterRow` & Retire `CampaignCharacterModal`
- [x] Refactor `frontend/src/components/inspector/CharacterRow.tsx` into a compact, non-expanding clickable card showing:
  - [x] Emotional expression portrait, Character Name, Party pill, Presence (`Present` / `Elsewhere · <Location>`), Mood label / emotion badge / shift dot, Valence/Arousal mini-bars, and compact Composure indicator.
  - [x] Clicking the card invokes `onOpenInCodex(character.id)`.
- [x] Update `frontend/src/components/LiveInspector.tsx` to pass `onOpenCharacterInCodex` to `CharacterRow` and remove `CampaignCharacterModal` state/rendering.
- [x] Delete `frontend/src/components/inspector/CampaignCharacterModal.tsx` and the old `frontend/src/components/inspector/campaignCharacter/` directory.

## Stage 5: Modular CSS, Tests & Architecture Verification
- [x] Update `frontend/src/styles/12-world-codex.css` with unified character header, subtab bar, inline bio drawer, 2-column personality grid, and persona tab styles.
- [x] Update `frontend/src/styles/06-inspector-and-lore.css` for the compact `CharacterRow` card + Composure bar, pruning any orphaned accordion/sheet classes.
- [x] Update `frontend/src/styles/15-responsive.css` for `<= 1100px` / `<= 820px` / `<= 620px` tab wrapping and single-column stacking.
- [x] Update and expand Vitest tests (`worldCodex.test.tsx`, `partyUi.test.tsx`, `tabbedSheetModals.test.tsx`, `videoAndGovernance.test.tsx`, `personaParity.test.tsx`).
- [x] Run required checks:
  - [x] `npm --prefix frontend run arch:check && npm --prefix frontend run css:audit && npm --prefix frontend run build && npm --prefix frontend test`
  - [x] `backend/.venv/bin/python scripts/generate_arch_docs.py && backend/.venv/bin/python scripts/generate_arch_docs.py --check`

## Stage 6: User-Facing Wiki Documentation & Lifecycle Closure
- [x] Inspect `../cybercantina-wiki/_Sidebar.md` and `../cybercantina-wiki/Home.md` and update all affected end-user guides (Live Inspector / Right Pane, World Codex / Major Characters, Campaign Mechanics).
- [x] Verify wiki diff with `git -C ../cybercantina-wiki diff`.
- [x] Mark all checkboxes and update feature package statuses to `completed`.
