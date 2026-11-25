---
feature: mobile-campaign-ux
target_version: 0.43.0
document_type: frd
status: completed
last_updated: 2026-11-26
---

# Feature Requirements Document — v0.43.0 Mobile Campaign UX, Turn Controls & Responsive Codex

## 1. Overview & Motivation

Running campaigns on mobile devices reveals several structural layout bottlenecks and touch-ergonomics issues across the turn feed, World Codex / Game Mechanics reader, composer, and modal overlays:

- **Turn Footer Swipe Clutter & Icon Collision (`TurnCard.tsx`):** Multi-swipe turns render flat `v1..vN` buttons preceded by a cyan `GitBranch` icon—which visually collides with the `Branch` action button and overflows narrow viewports. Meanwhile, `Delete` is an immediate single-tap destructive action right next to `Swipe`, with no label hiding or mis-tap protection on phones.
- **Cramped Game Mechanics & Codex Browser (`WorldCodexTab.tsx`, `WorldInspectorModal.tsx`):** On `<= 820px`, the 2-pane Codex stacks `.codex-left-pane` permanently above `.codex-right-pane`, burying Game Mechanics articles below modal tabs, Codex top bars, 7 wrapping pills, a filter input, and a nested scroll tree—while ~112px of cumulative horizontal padding and a read-only footer eat critical viewport area.
- **Mobile Campaign Ergonomics Gaps:** Hardcoded multi-column grids (`.cognition-steps`, `DirectorChoicesDrawer` option rows, World Sheet `Base` 3-col grid), bare `Enter` submitting mid-message on touch keyboards lacking `Shift+Enter`, 2-row wrapping composer footer, full-date timestamps squeezing mobile campaign titles, missing `viewport-fit=cover` for safe-area insets, non-fullscreen campaign modals, missing `touch-action: none` / pinch-zoom on `BranchGraphCanvas`, tiny mini-map node hit targets, and absent drawer swipe-to-dismiss / jump-to-latest navigation.

**Core UX Goal:** Streamline turn version switching (`‹ v#/N ›` + preview popover) and leaf deletion safety (`2-tap confirm` + icon-only mobile Delete), transform the Codex & Game Mechanics browser into a single-pane drill-down with a reader-first topic switcher on mobile, and deliver first-class mobile campaign playability across the stage, composer, drawers, and modals.

---

## 2. Agreed Product Decisions

### 2.1 TurnCard Footer Redesign
- **Unified Swipe Switcher (`TurnSwipeSwitcher.tsx`):** Replace flat `v1..vN` chips across all viewports with a compact segmented stepper + popover (`‹ v2/6 ›`). Left/right chevrons step immediately through sibling swipes; tapping the center pill opens a `.ui-popover` listing all siblings with `v#`, `Active` badge, bookmark indicator, `+N` descendant branch count badge, `Edited` badge (when the user prompt differs from `v1`), and a 1-line prompt/prose preview.
- **Remove Colliding `GitBranch` Icon:** Remove the cyan `GitBranch` icon beside sibling swipes completely so `GitBranch` remains dedicated to timeline branching (`Branch`, rewind banner, `Story → Timelines`).
- **2-Tap Confirm + Mobile Icon-Only Delete:** Keep a subtle vertical divider separating `Edit` / `Swipe` from `Delete`. On first click/tap, `Delete` enters an inline `Confirm?` state (auto-resetting after 4s or on turn/busy state changes); a second click/tap invokes deletion. On narrow phones (`<= 620px`), hide the `"Delete"` label at rest (`min-width: 32px; min-height: 32px` trash icon only) while revealing `"Confirm?"` during the confirmation step.
- **Cognition Header Brevity:** Hide verbose parentheticals like `(Recall → Feel → Want → Plan)` on `<= 620px` so the cognition bar stays concise.

### 2.2 Game Mechanics & World Codex Mobile Reader (`<= 820px`)
- **Unified Single-Pane Drill-Down (`WorldCodexTab.tsx`):** Keep both panes in DOM for desktop `> 820px` and SSR compatibility, switching visibility on `<= 820px` via `.codex-two-pane--mobile-list` vs `.codex-two-pane--mobile-detail`. Selecting an entry or creating a new lore note transitions to Detail view; external deep-links (`?` buttons, Character/Persona links, Lore jumps) open directly in Detail view.
- **Reader-First Game Mechanics Switcher & Pager:** On mobile Detail view, display a sticky `.codex-mobile-detail-bar` with `← Topics` (or `← <Category>`) back button and, in Game Mechanics, a tappable topic picker trigger opening a searchable bottom/overlay sheet of all 7 subcategories and 24 guides. Add `← Previous` / `Next →` guide navigation at the bottom of `CodexMechanicsDetail`.
- **Slim Mobile Modal Chrome:** Collapse the World Sheet `Base` 3-column grid to 1 column at `<= 820px`, hide the redundant `.modal-footer` on `<= 820px` when viewing clean read-only Codex in Campaign Mode (`isCampaignMode && !isDirty && activeTab === "codex"`), and compact mobile modal/pane padding.
- **Contextual `?` Help (`<= 620px`):** Keep `?` hidden in the tight Composer footer on `<= 620px`, while **re-enabling** `.inspector .ui-mechanics-help-btn` inside the Inspector overlay drawer.

### 2.3 Stage Header, Turn Feed & Cognition Mobile Defaults
- **Compact Stage Clock (`<= 620px`):** Hide the date prefix (`YYYY-MM-DD `) in `.stage-clock-cluster` on `<= 620px` (displaying `HH:MM | #N`, with full date preserved in tooltips and turn cards). Expand vertical touch hit area on `.stage-context-subline--interactive`.
- **Mobile Default-Collapsed Cognition (`<= 820px`):** When `isMobileLayout` is active (`tier === "mobile"`), start the latest turn's Cognition drawer collapsed by default (preserving the 1-line feeling/tone summary in the header) so narrative prose stays immediately visible.
- **Floating Jump-to-Latest Button:** Show a floating `↓ Latest` pill in `.chat-stage-feed-region` whenever the user scrolls away from the bottom of `.turn-feed` (`> 140px`).

### 2.4 Composer, Drawers, Modals & Touch Ergonomics
- **Single-Row Composer Footer (`<= 620px`):** Condense secondary actions (`GM Talk`, `Narrator`, `Exits`, `Choices`) to icon-only buttons (retaining count badges & streaming dot) alongside compact `Dice`, `Cancel`, and `Save` / `Send` buttons on one `flex-wrap: nowrap` row.
- **Coarse-Pointer `Enter = Newline`:** On `(pointer: coarse)` devices, pressing `Enter` in either Story or GM Talk textareas inserts a newline; sending uses `Send` / `Ask GM` (while `Enter` continues to pick items when `@` mention or `/` slash popovers are open). Desktop (`pointer: fine`) retains `Enter = Send`, `Shift+Enter = newline`.
- **`DirectorChoicesDrawer` & iOS Anti-Zoom:** Stack `.choices-option-row` into 2 clean sub-rows on `<= 620px` and apply `font-size: 16px` across interactive inputs/selects (`DirectorChoicesDrawer`, `TurnBookmarkNoteRow`, Codex search inputs, GM Codex proposal fields) at `<= 820px`. Cap slash/mention list heights to `min(240px, 34dvh)` on mobile.
- **Compact `GmTalkDrawer` Header (`<= 620px`):** Shorten spoiler badge (`GM Mode` / `Spoiler-Safe`) and collapse `"Clear Chat"` to icon-only until `"Confirm Clear?"`.
- **Full-Screen Modals & `BranchGraphCanvas` Touch Controls:** Make `StoryModal`, `ContextHealthModal`, and `PartyManagementModal` full-screen (`100vw × 100dvh`) at `<= 820px` with scrollable `.story-modal-tabs`. Add `touch-action: none` and 2-finger pinch-zoom + single-finger pointer pan to `BranchGraphCanvas`. Add `viewport-fit=cover` in `index.html`.
- **Touch Drawer & Mini-Map Ergonomics:** Add `r={22}` transparent SVG hit circles to `InspectorLocationCard` mini-map nodes and swipe-to-dismiss touch gestures (edge-directed with vertical-scroll lock & SVG/input guards) on mobile overlay `AppSidebar` and `LiveInspector`.
