---
feature: campaign-ui-polish
target_version: 0.45.1
document_type: review
status: completed
last_updated: 2026-11-26
---

# Pre-Implementation Review — Campaign UI Polish & Bugfixes

## Key Architectural & CSS Traps and Mitigations

### 1. Stylesheet Cascade Order (`04-chat-and-turns.css` vs. `07-modals-and-forms.css`)
- **Trap:** `frontend/src/styles.css` imports `04-chat-and-turns.css` (line 6) **before** `07-modals-and-forms.css` (line 9). Replacing `modal-card` with `modal-panel` on `ContextHealthModal.tsx` causes `.modal-panel` (`width: min(760px, 94vw); max-height: 88vh;`) and `.modal-body` (`padding: 18px 20px;`) in `07-modals-and-forms.css` to override `.context-health-modal` (`width: min(800px, 94vw); max-height: 86vh;`) and `.context-health-modal-body` (`padding: 16px 18px 20px;`) in `04-chat-and-turns.css`.
- **Mitigation:** Move the `.context-health-modal*` modal layout rules after `07-modals-and-forms.css` (or use higher-specificity compound selectors `.modal-panel.context-health-modal` and `.modal-body.context-health-modal-body` in CSS while matching specificity in `@media (max-width: 820px)` in `15-responsive.css` without `!important`). Verify desktop `800px` width and mobile `100vw`/`100dvh` full-screen behavior both win cleanly.

### 2. Undefined Utility Classes (`btn-icon`, `btn-sm`, `modal-card`)
- **Trap:** Neither `.btn-icon` nor `.btn-sm` is defined anywhere in `frontend/src/styles/`. In `ContextHealthModal.tsx`, `btn btn-icon` renders a chunky default `.btn` close button and `btn btn-sm` renders a full-size CTA button.
- **Mitigation:** Give `ContextHealthModal.tsx` explicitly defined compact button classes (e.g., `.context-health-close-btn` and `.context-health-settings-btn`, or well-scoped shared `.btn--icon` / `.btn--sm` primitives if appropriate) in the stylesheet rather than relying on undefined class names. Leave unrelated legacy usages (e.g., `PromptPresetsManager.tsx`'s inline-styled `modal-card`) untouched as out of scope.

### 3. `css:audit` Enforcement & Slash Accent Tokens
- **Trap:** `frontend/scripts/audit-css.mjs` fails CI on any orphan `.className` selector not referenced in TSX/TS/HTML, any undefined `@keyframes`, or any unguarded `var(--*)` token. Switching `/choice` from `accent: "blue"` to `accent: "emerald"` makes `.composer-slash-pill--blue` and `.slash-picker-icon--blue` in `05-composer-and-slash.css` unused (confirmed `choice` is the only command with `accent: "blue"` in `slashCommands.ts`), while `.composer-slash-pill--emerald` and `.slash-picker-icon--emerald` must be added.
- **Mitigation:** Remove `.composer-slash-pill--blue` and `.slash-picker-icon--blue` when migrating `choice` to `emerald`, add `.composer-slash-pill--emerald` and `.slash-picker-icon--emerald`, ensure `SlashCommandAccent` in `frontend/src/types/` includes `"emerald"`, and keep all new CSS classes referenced in TSX and all custom properties defined in `00-tokens.css` (avoiding raw hex/rgba literals).

### 4. Mobile `NotesFlyout` Backdrop vs. Document `mousedown` Listener & Back Stack
- **Trap:** `NotesFlyout` in `NotesDrawer.tsx` registers a `document.addEventListener("mousedown", handleClickOutside)` listener checking `!flyoutRef.current.contains(e.target)`. Adding a mobile `.notes-flyout-backdrop` sibling outside `flyoutRef` could trigger both the backdrop `onClick` and `mousedown` outside handler, or race with `useOverlayBackHandler` (`id: "notes-flyout"`, `priority: 2` in `App.tsx`).
- **Mitigation:** Keep the backdrop as a sibling `div.notes-flyout-backdrop` inside the `NotesFlyout` fragment/wrapper (or give it `aria-hidden="true"` and `onClick={onClose}`), and ensure `handleClickOutside` either ignores clicks handled by the backdrop or guards cleanly so `onClose()` is idempotent. On mobile/coarse pointers, gate `autoFocus` on `(window.matchMedia?.("(pointer: fine)").matches && window.innerWidth > 820)` (guarded for Node/SSR test environments where `window` is undefined).

### 5. Mobile Composer Footer (`<= 620px`) Width Budget & iOS `16px` Input Rule
- **Trap:** At `@media (max-width: 620px)` in `15-responsive.css`, `.composer-footer` uses `flex-wrap: nowrap`, and at `@media (max-width: 820px)` `.field-input.composer-dice-override-input` enforces `font-size: 16px` to prevent iOS Safari zoom. Raising `.btn-dice-toggle` to `min-height: 32px` with overly generous horizontal padding or failing to align `.composer-dice-override-input`'s height/padding at `font-size: 16px` can cause horizontal overflow on ~360px screens or misaligned input height.
- **Mitigation:** Keep `.btn-dice-toggle` horizontal padding tight on `<= 620px` (`padding: 4px 7px`) and explicitly size `.field-input.composer-dice-override-input` (`height: 28px` desktop, `height: 32px` on `<= 620px`, `box-sizing: border-box`, compact padding) so all controls align vertically at `28px` / `32px` without overflowing narrow viewports.

### 6. Existing Test Suite & SSR Coverage
- **Trap:** Vitest runs in a Node-only environment (`ReactDOMServer.renderToStaticMarkup` without `jsdom`). Existing specs (`contextHealth.test.tsx`, `slashCommandUi.test.tsx`, `mobileCampaignUx.test.tsx`, `emptyRoomSolo.test.tsx`, `slashCommands.test.ts`, `turnProseModelPill.test.tsx`) inspect rendered markup and CSS/class contracts.
- **Mitigation:** Verify and update any test expectations referencing removed `"blue"` accent classes, `"modal-card"`, or `"• "` timestamp text, and add SSR assertions covering `.modal-panel.context-health-modal`, `.turn-meta-pill`, emerald Director Choices classes, and `.notes-flyout-backdrop`.
